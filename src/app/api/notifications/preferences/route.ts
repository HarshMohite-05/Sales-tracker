import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJson } from '@/lib/inputValidation';
import { errorResponse } from '@/lib/apiErrors';
import { pushCategoriesOf, UPDATE_CATEGORIES } from '@/lib/notificationCategories';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The signed-in person's notification settings: morning summary and, for directors, which updates buzz their phone. */
export async function GET() {
  try {
    const user = await requireAuth();
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { role: true, morningSummaryEnabled: true, morningSummaryTime: true, pushCategories: true, _count: { select: { pushSubscriptions: true } } },
    });
    return NextResponse.json({
      morningSummaryEnabled: me.morningSummaryEnabled,
      morningSummaryTime: me.morningSummaryTime,
      pushCategories: me.role === Role.DIRECTOR ? pushCategoriesOf(me.pushCategories) : null,
      devices: me._count.pushSubscriptions,
    });
  } catch (error: any) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    const body = await readJson(request);
    const data: { morningSummaryEnabled?: boolean; morningSummaryTime?: string; pushCategories?: string[] } = {};
    if (body.morningSummaryEnabled !== undefined) data.morningSummaryEnabled = !!body.morningSummaryEnabled;
    if (body.morningSummaryTime !== undefined) {
      if (typeof body.morningSummaryTime !== 'string' || !TIME.test(body.morningSummaryTime)) {
        return NextResponse.json({ error: 'Choose a time for the morning summary' }, { status: 400 });
      }
      data.morningSummaryTime = body.morningSummaryTime;
    }
    if (body.pushCategories !== undefined) {
      if (user.role !== Role.DIRECTOR) return NextResponse.json({ error: 'Only directors choose which updates buzz their phone' }, { status: 403 });
      const known = UPDATE_CATEGORIES.map((c) => c.key as string);
      if (!Array.isArray(body.pushCategories) || body.pushCategories.some((c: unknown) => typeof c !== 'string' || !known.includes(c))) {
        return NextResponse.json({ error: 'Unknown kind of update' }, { status: 400 });
      }
      data.pushCategories = body.pushCategories;
    }
    await prisma.user.update({ where: { id: user.id }, data });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}
