import { readJson } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ConflictError, ValidationError } from '@/lib/apiErrors';
import { validDateInput } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import * as XLSX from 'xlsx';
import { autoClientCode } from '@/lib/clientCodeServer';
import { Role, ActivityType, DiscussionType, EnquiryCategory, EnquiryStage } from '@prisma/client';

export async function POST(request: Request) {
  try {
    const director = await requireDirector();
    const contentType = request.headers.get('content-type') || '';

    // Check if multipart form upload or JSON execute
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'Excel file (.xlsx / .xls) is required' }, { status: 400 });
      }

      if (typeof file === 'string' || !/\.xlsx?$/i.test(file.name)) return NextResponse.json({ error: 'Upload an Excel .xlsx or .xls file' }, { status: 400 });
      if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'The workbook must be 10 MB or smaller' }, { status: 400 });
      const bytes = await file.arrayBuffer();
      const signature = new Uint8Array(bytes);
      if (!((signature[0] === 0x50 && signature[1] === 0x4b) || (signature[0] === 0xd0 && signature[1] === 0xcf))) {
        return NextResponse.json({ error: 'The file is not a valid Excel workbook' }, { status: 400 });
      }
      const workbook = XLSX.read(bytes, { type: 'buffer' });
      const sheetNames = workbook.SheetNames;

      // Extract sheets and detect sheet types
      const sheetsData: Record<string, { detectedType: string; rowCount: number; sampleRows: any[]; rows: any[]; headers: string[] }> = {};

      for (const name of sheetNames) {
        const sheet = workbook.Sheets[name];
        const rawJson: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (rawJson.length === 0) continue;

        const headers = Object.keys(rawJson[0]);
        let detectedType = 'Unknown';
        const lowerName = name.toLowerCase();

        if (lowerName.includes('activity') || lowerName.includes('daily')) {
          detectedType = 'Daily Activity Tracker';
        } else if (lowerName.includes('lead') || lowerName.includes('opportunity')) {
          detectedType = 'Lead & Opportunity Tracker';
        } else if (lowerName.includes('proposal') || lowerName.includes('quotation')) {
          detectedType = 'Proposal Tracker';
        } else if (lowerName.includes('order') || lowerName.includes('revenue')) {
          detectedType = 'Order & Revenue Tracker';
        } else if (lowerName.includes('weekly') || lowerName.includes('performance')) {
          detectedType = 'Weekly Performance';
        } else if (lowerName.includes('target') || lowerName.includes('incentive')) {
          detectedType = 'Quarterly Targets and Incentives';
        }

        sheetsData[name] = {
          detectedType,
          rowCount: rawJson.length,
          headers,
          sampleRows: rawJson.slice(0, 5),
          rows: rawJson,
        };
      }

      return NextResponse.json({
        success: true,
        fileName: file.name,
        sheets: sheetsData,
      });
    }

    // JSON action: EXECUTE_IMPORT
    const body = await readJson(request);
    const { fileName, sheetType, rows, assignToSalespersonId } = body;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided for import' }, { status: 400 });
    }

    if (sheetType !== 'Daily Activity Tracker') {
      return NextResponse.json({ error: 'Only Daily Activity Tracker import is currently supported. Other sheets have not been imported.' }, { status: 400 });
    }
    if (!Array.isArray(rows) || rows.length > 5000) return NextResponse.json({ error: 'Provide at most 5000 activity rows per batch' }, { status: 400 });
    // Check duplicate import batch by file name
    const existingBatch = await prisma.importBatch.findFirst({
      where: { fileName, sheetType },
    });

    if (existingBatch) {
      return NextResponse.json(
        { error: `This file "${fileName}" has already been imported previously. Please rename or select a different batch to prevent duplicate record creation.` },
        { status: 400 }
      );
    }

    // Default salesperson if not matched
    const defaultSalesperson = assignToSalespersonId
      ? await prisma.user.findUnique({ where: { id: assignToSalespersonId } })
      : await prisma.user.findFirst({ where: { role: Role.SALESPERSON, isActive: true } });

    if (!defaultSalesperson || !defaultSalesperson.isActive || defaultSalesperson.role !== Role.SALESPERSON) {
      return NextResponse.json({ error: 'A valid active salesperson must be selected for record ownership' }, { status: 400 });
    }

    // Execute Import Transactionally with Provenance Tracking
    const summary = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `import:${fileName}:${sheetType}`);
      if (await tx.importBatch.findFirst({ where: { fileName, sheetType } })) throw new ConflictError('This batch has already been imported');
      const batch = await tx.importBatch.create({
        data: {
          fileName: fileName || 'excel_import.xlsx',
          sheetType: sheetType || 'Daily Activity Tracker',
          totalRows: rows.length,
          importedById: director.id,
        },
      });

      let importedCount = 0;
      let skippedCount = 0;
      let rejectedCount = 0;
      const errorsList: any[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 1;

        // Skip completely empty rows or template header repeats
        const values = Object.values(row).map((v) => String(v).trim()).filter(Boolean);
        if (values.length === 0) {
          skippedCount++;
          await tx.importRowProvenance.create({
            data: {
              batchId: batch.id,
              sourceSheet: sheetType,
              sourceRowNumber: rowNum,
              rawData: row,
              status: 'SKIPPED',
              errorReason: 'Empty row or template row',
            },
          });
          continue;
        }

        await tx.$executeRawUnsafe('SAVEPOINT import_row');
        try {
          // Identify client name from common headers
          const clientName =
            row['Client / Company Name'] ||
            row['Client / Prospect Name'] ||
            row['Client Name'] ||
            row['Company'] ||
            row['Client'];

          if (!clientName || String(clientName).trim().length === 0) {
            skippedCount++;
            await tx.importRowProvenance.create({
              data: {
                batchId: batch.id,
                sourceSheet: sheetType,
                sourceRowNumber: rowNum,
                rawData: row,
                status: 'SKIPPED',
                errorReason: 'Missing client or company name',
              },
            });
            continue;
          }

          const cleanClientName = String(clientName).trim();
          const industrySegment = String(row['Industry Segment'] || row['Industry'] || 'Other').trim();
          const contactPerson = String(row['Contact Person'] || row['Contact'] || 'Primary Contact').trim();
          const location = String(row['Location'] || row['City'] || '').trim();
          const mobile = String(row['Mobile Number'] || row['Contact Number'] || row['Phone'] || '').trim();
          const email = String(row['Email Address'] || row['Email'] || '').trim();

          let activityDate: Date | undefined;
          const rawDate = row['Date'] ?? row['Activity Date'];
          if (rawDate !== undefined && rawDate !== '') {
            if (typeof rawDate === 'number') {
              const date = XLSX.SSF.parse_date_code(rawDate);
              if (!date) throw new ValidationError('Invalid activity date');
              activityDate = new Date(Date.UTC(date.y, date.m - 1, date.d, date.H, date.M, date.S));
            } else {
              if (!validDateInput(rawDate)) throw new ValidationError('Use an ISO date or an Excel date cell');
              activityDate = new Date(rawDate);
            }
          }
          // 1. Find or create client (prevent duplicate client rows if same name exists)
          let client = await tx.client.findFirst({
            where: { name: { equals: cleanClientName, mode: 'insensitive' } },
          });

          if (!client) {
            client = await tx.client.create({
              data: {
                name: cleanClientName,
                code: await autoClientCode(tx, cleanClientName),
                industrySegment: industrySegment || 'Other',
                city: location,
                assignedToId: defaultSalesperson.id,
                createdById: director.id,
                contacts: {
                  create: [
                    {
                      name: contactPerson || 'Primary Contact',
                      mobile: mobile || 'N/A',
                      email: email || null,
                      isPrimary: true,
                    },
                  ],
                },
              },
            });
          }

          // 2. Process Activity / Enquiry depending on sheet type
          const requirement = row['Client Requirement'] || row['Requirement'] || row['Title'];
          const activityType = row['Type of Activity'] || row['Activity Type'];
          const outcome = row['Call Outcome'] || row['Call / Activity Outcome'] || row['Outcome'] || 'Imported interaction';
          const discussionType = row['Meeting Type'] || row['Meeting / Discussion Type'];
          const keyPoints = row['Key Discussion Points'] || row['Discussion Points'] || row['Notes'] || 'Historical record';
          const nextAction = row['Next Action'];
          const nextActionDate = row['Next Action Date'];

          // Create Activity if discussion points or activity type exist
          if (activityType || keyPoints) {
            let actType: ActivityType = ActivityType.CALL;
            const actStr = String(activityType || '').toLowerCase();
            if (actStr.includes('meet')) actType = ActivityType.MEETING;
            else if (actStr.includes('visit') || actStr.includes('site')) actType = ActivityType.SITE_VISIT;
            else if (actStr.includes('mail')) actType = ActivityType.EMAIL;
            else if (actStr.includes('whats')) actType = ActivityType.WHATSAPP;

            let discType: DiscussionType = DiscussionType.INTRODUCTORY;
            const discStr = String(discussionType || '').toLowerCase();
            if (discStr.includes('tech')) discType = DiscussionType.TECHNICAL;
            else if (discStr.includes('comm')) discType = DiscussionType.COMMERCIAL;

            await tx.activity.create({
              data: {
                clientId: client.id,
                salespersonId: defaultSalesperson.id,
                ...(activityDate ? { activityDate } : {}),
                activityType: actType,
                discussionType: discType,
                outcome: String(outcome).trim(),
                keyPoints: String(keyPoints).trim(),
                remarks: row['Remarks'] ? String(row['Remarks']).trim() : 'Imported from Excel',
                // Important rule: Preserve original text and dates. Historical rows do not create live reminder storm!
                nextAction: nextAction ? String(nextAction).trim() : null,
              },
            });
          }

          // Provenance logging
          await tx.importRowProvenance.create({
            data: {
              batchId: batch.id,
              sourceSheet: sheetType,
              sourceRowNumber: rowNum,
              rawData: row,
              status: 'IMPORTED',
              targetEntity: 'CLIENT',
              targetId: client.id,
            },
          });

          importedCount++;
        } catch (err: any) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_row');
          rejectedCount++;
          errorsList.push({ row: rowNum, error: err.message });
          await tx.importRowProvenance.create({
            data: {
              batchId: batch.id,
              sourceSheet: sheetType,
              sourceRowNumber: rowNum,
              rawData: row,
              status: 'REJECTED',
              errorReason: err.message,
            },
          });
        }
      }

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          importedCount,
          skippedCount,
          rejectedCount,
          errors: errorsList,
        },
      });

      return {
        batchId: batch.id,
        total: rows.length,
        importedCount,
        skippedCount,
        rejectedCount,
        errors: errorsList,
      };
    });

    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    if (error.message === 'FORBIDDEN_DIRECTOR_ONLY') {
      return NextResponse.json({ error: 'Only directors can import legacy Excel records' }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
