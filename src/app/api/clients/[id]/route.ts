import { readJson } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth, requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertClientAccess } from '@/lib/rbac';
import { Role } from '@prisma/client';
import { checkClientCode } from '@/lib/clientCodeServer';
import { normalizeClientCode as normalizeCode } from '@/lib/clientCode';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    // Check authorization
    await assertClientAccess(user, id);
    const own = user.role === Role.SALESPERSON;

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, name: true, email: true, mobile: true, designation: true } },
        createdBy: { select: { id: true, name: true } },
        contacts: { orderBy: { isPrimary: 'desc' } },
        sites: { orderBy: { isPrimary: 'desc' } },
        enquiries: {
          where: own ? { assignedToId: user.id } : {},
          include: {
            assignedTo: { select: { id: true, name: true } },
            stageHistory: {
              include: { changedBy: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'desc' },
            },
            quotations: {
              where: own ? { salespersonId: user.id } : {},
              include: {
                versions: { orderBy: { versionNumber: 'desc' } },
                approvals: true,
              },
              orderBy: { createdAt: 'desc' },
            },
            tasks: { where: own ? { assignedSalespersonId: user.id } : {}, orderBy: { dueDateTime: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
        activities: {
          where: own ? { salespersonId: user.id } : {},
          include: {
            salesperson: { select: { id: true, name: true } },
            enquiry: { select: { id: true, enquiryNumber: true, title: true } },
          },
          orderBy: { activityDate: 'desc' },
        },
        tasks: {
          where: own ? { assignedSalespersonId: user.id } : {},
          include: {
            client: { select: { id: true, name: true } },
            assignedSalesperson: { select: { id: true, name: true } },
            enquiry: { select: { id: true, enquiryNumber: true, title: true, stage: true } },
            rescheduleHistory: {
              include: { rescheduledBy: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { dueDateTime: 'asc' },
        },
        quotations: {
          where: own ? { salespersonId: user.id } : {},
          include: {
            versions: { orderBy: { versionNumber: 'desc' } },
            approvals: true,
            salesperson: { select: { id: true, name: true } },
            enquiry: { select: { id: true, enquiryNumber: true, title: true } },
          },
          orderBy: { proposalDate: 'desc' },
        },
        orders: {
          where: own ? { assignedSalespersonId: user.id } : {},
          include: {
            assignedSalesperson: { select: { id: true, name: true } },
            enquiry: {
              select: { id: true, enquiryNumber: true, title: true, category: true, categories: true, categoryOther: true, approxValue: true },
            },
            quotation: { select: { id: true, quotationNumber: true } },
            quotationVersion: { select: { versionNumber: true, remarks: true } },
            payments: { include: { completedBy: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' } },
            executionSteps: { include: { updatedBy: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' } },
            deliveryRevisions: { include: { revisedBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
            receipts: {
              include: { recordedBy: { select: { id: true, name: true } }, reversedBy: { select: { id: true, name: true } } },
              orderBy: { receivedDate: 'asc' },
            },
            excessReviewedBy: { select: { id: true, name: true } },
            invoices: {
              include: {
                allocations: {
                  include: { receipt: true },
                },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
        invoices: {
          where: own ? { order: { assignedSalespersonId: user.id } } : {},
          include: {
            order: { select: { orderNumber: true } },
            allocations: {
              include: {
                receipt: {
                  include: { recordedBy: { select: { id: true, name: true } } },
                },
              },
            },
          },
          orderBy: { invoiceDate: 'desc' },
        },
        receipts: {
          where: own ? { OR: [{ allocations: { some: { invoice: { order: { assignedSalespersonId: user.id } } } } }, { recordedById: user.id }] } : {},
          include: {
            recordedBy: { select: { id: true, name: true } },
            verifiedBy: { select: { id: true, name: true } },
            allocations: {
              where: own ? { invoice: { order: { assignedSalespersonId: user.id } } } : {},
              include: { invoice: { select: { invoiceNumber: true } } },
            },
          },
          orderBy: { receiptDate: 'desc' },
        },
      },
    });

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Fetch director comments for this client and its entities
    const directorComments = await prisma.directorComment.findMany({
      where: {
        ...(own ? { AND: [{ OR: [{ targetSalespersonId: user.id }, { targetSalespersonId: null }] }] } : {}),
        OR: [
          { entityType: 'CLIENT', entityId: id },
          { entityType: 'ENQUIRY', entityId: { in: client.enquiries.map((e) => e.id) } },
          { entityType: 'QUOTATION', entityId: { in: client.quotations.map((q) => q.id) } },
        ],
      },
      include: {
        director: { select: { id: true, name: true } },
        targetSalesperson: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch audit events
    // Change log covers the client and everything that belongs to it
    const receipts = client.receipts;
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        OR: [
          { entityType: 'CLIENT', entityId: id },
          { entityType: 'ENQUIRY', entityId: { in: client.enquiries.map((e) => e.id) } },
          { entityType: 'QUOTATION', entityId: { in: client.quotations.map((q) => q.id) } },
          { entityType: 'ORDER', entityId: { in: client.orders.map((o) => o.id) } },
          { entityType: 'INVOICE', entityId: { in: client.orders.flatMap((o) => o.invoices.map((i) => i.id)) } },
          { entityType: 'RECEIPT', entityId: { in: receipts.map((r) => r.id) } },
        ],
      },
      include: {
        actor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      client,
      directorComments,
      auditEvents,
    });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertClientAccess(user, id);

    const body = await readJson(request);
    const { assignedToId, name, industrySegment, clientType, gstNumber, city, address, state, code: rawCode } = body;

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
    }

    // Client code can change only until a requirement has been numbered with it
    let code: string | undefined;
    if (rawCode !== undefined) {
      const current = await prisma.client.findUnique({ where: { id }, select: { code: true } });
      if (current?.code && normalizeCode(rawCode) !== current.code) {
        const used = await prisma.enquiry.count({ where: { enquiryNumber: { startsWith: `${current.code}/` } } });
        if (used > 0) {
          return NextResponse.json(
            { error: `${current.code} is already used in requirement numbers, so it can't be changed.` },
            { status: 400 }
          );
        }
      }
      const codeCheck = await checkClientCode(prisma, rawCode, id, user.role === Role.DIRECTOR);
      if (codeCheck.error) {
        return NextResponse.json({ error: codeCheck.error, suggestion: codeCheck.suggestion }, { status: 400 });
      }
      code = codeCheck.code;
    }

    // Rule: Only directors can reassign a client to another salesperson
    if (assignedToId && assignedToId !== user.id && user.role !== Role.DIRECTOR) {
      return NextResponse.json(
        { error: 'Only directors can reassign clients to another salesperson' },
        { status: 403 }
      );
    }

    if (assignedToId) {
      const assignee = await prisma.user.findUnique({ where: { id: assignedToId } });
      if (!assignee?.isActive || assignee.role !== Role.SALESPERSON) {
        return NextResponse.json({ error: 'Choose an active salesperson' }, { status: 400 });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.client.findUnique({ where: { id } });
      if (!existing) throw new Error('Client not found');

      const client = await tx.client.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(industrySegment !== undefined ? { industrySegment: industrySegment } : {}),
          ...(clientType !== undefined ? { clientType: clientType } : {}),
          ...(gstNumber !== undefined ? { gstNumber: gstNumber } : {}),
          ...(city !== undefined ? { city: city } : {}),
          ...(address !== undefined ? { address: address } : {}),
          ...(state !== undefined ? { state: state } : {}),
          ...(assignedToId !== undefined ? { assignedToId: assignedToId } : {}),
        },
      });

      if (assignedToId && assignedToId !== existing.assignedToId) {
        await tx.auditEvent.create({
          data: {
            entityType: 'CLIENT',
            entityId: id,
            action: 'REASSIGN',
            actorId: user.id,
            details: {
              previousAssignedId: existing.assignedToId,
              newAssignedId: assignedToId,
            },
          },
        });
      }

      return client;
    });

    return NextResponse.json({ success: true, client: updated });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
