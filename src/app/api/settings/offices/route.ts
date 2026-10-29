import { NextResponse } from 'next/server';
import { requireAuth, requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJson } from '@/lib/inputValidation';
import { errorResponse } from '@/lib/apiErrors';

const FIELDS = ['address', 'phone', 'email', 'gstin'] as const;

/** The offices and their letterhead details (printed on quotations). */
export async function GET() {
  try {
    await requireAuth();
    const offices = await prisma.office.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: { where: { isActive: true } } } } } });
    return NextResponse.json({ offices });
  } catch (error: any) {
    return errorResponse(error);
  }
}

/** Directors change an office's address, phone, email or GSTIN. */
export async function PATCH(request: Request) {
  try {
    const director = await requireDirector();
    const body = await readJson(request);
    const office = await prisma.office.findUnique({ where: { id: String(body.id || '') } });
    if (!office) return NextResponse.json({ error: 'Office not found' }, { status: 404 });
    const data: Partial<Record<(typeof FIELDS)[number], string | null>> = {};
    for (const f of FIELDS) {
      if (body[f] === undefined) continue;
      const v = String(body[f] ?? '').trim();
      if (v.length > 300) return NextResponse.json({ error: `${f} is too long` }, { status: 400 });
      data[f] = v || null;
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
    if (data.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/i.test(data.gstin)) return NextResponse.json({ error: 'GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5' }, { status: 400 });
    if (data.gstin) data.gstin = data.gstin.toUpperCase();
    const saved = await prisma.office.update({ where: { id: office.id }, data });
    await prisma.auditEvent.create({
      data: { entityType: 'SETTINGS', entityId: office.id, action: 'UPDATE', actorId: director.id, details: { label: `${office.name} office details updated` } },
    });
    return NextResponse.json({ success: true, office: saved });
  } catch (error: any) {
    return errorResponse(error);
  }
}
