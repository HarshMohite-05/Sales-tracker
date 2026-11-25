import { NextResponse } from 'next/server';
import { requireDirector } from '@/lib/auth';
import { errorResponse } from '@/lib/apiErrors';
import { readJson } from '@/lib/inputValidation';
import { businessDataCounts, clearAllBusinessData, CLEAR_ALL_CONFIRMATION, KEPT_TABLES } from '@/lib/dataReset';

/** Director only: how many business records the app holds, table by table. */
export async function GET() {
  try {
    await requireDirector();
    const counts = await businessDataCounts();
    return NextResponse.json({ counts, kept: KEPT_TABLES.filter((t) => !t.startsWith('_')), confirmation: CLEAR_ALL_CONFIRMATION });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Director only: permanently empties every business table (clients, requirements, quotations, orders, payments,
 * follow-ups, targets, incentives, notifications, logs). Users, offices and settings stay.
 */
export async function POST(request: Request) {
  try {
    const director = await requireDirector();
    const body = await readJson(request);
    if (body?.confirm !== CLEAR_ALL_CONFIRMATION) {
      return NextResponse.json({ error: `Type ${CLEAR_ALL_CONFIRMATION} to confirm` }, { status: 400 });
    }
    const before = await clearAllBusinessData(director.id);
    return NextResponse.json({ success: true, cleared: before.reduce((s, c) => s + c.rows, 0) });
  } catch (error) {
    return errorResponse(error);
  }
}
