import { readJson } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth, UserSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { NotificationType, Role } from '@prisma/client';
import { assertClientAccess, assertEnquiryAccess, assertOrderAccess, assertQuotationAccess, commentVisibility } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');

    const whereClause: any = {};
    if (entityType) whereClause.entityType = entityType;
    if (entityId) whereClause.entityId = entityId;

    Object.assign(whereClause, await commentVisibility(user));

    const comments = await prisma.directorComment.findMany({
      where: whereClause,
      include: {
        director: { select: { id: true, name: true, designation: true } },
        targetSalesperson: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ comments });
  } catch (error: any) {
    return apiErrorResponse(error);
  }
}

// Notes, attached to a client (general) or a requirement / quotation / order. Directors and the
// salespeople responsible both write them, on records they can open.
const NOTE_ACCESS: Record<string, (user: UserSession, id: string) => Promise<boolean>> = {
  CLIENT: assertClientAccess,
  ENQUIRY: assertEnquiryAccess,
  QUOTATION: assertQuotationAccess,
  ORDER: assertOrderAccess,
};

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await readJson(request);

    const { entityType, entityId, instruction, targetSalespersonId } = body;
    const text = String(instruction ?? '').trim();

    if (!entityType || !entityId || !text) {
      return NextResponse.json({ error: 'Write the note and choose what it is about' }, { status: 400 });
    }
    if (!NOTE_ACCESS[entityType]) {
      return NextResponse.json({ error: 'Notes can be added to a client, requirement, quotation or order' }, { status: 400 });
    }
    await NOTE_ACCESS[entityType](user, entityId);

    // A director's note is addressed to the salesperson responsible; a salesperson's note is for
    // everyone who can open the record
    const target = user.role === Role.DIRECTOR ? targetSalespersonId || null : null;

    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.directorComment.create({
        data: {
          entityType,
          entityId,
          directorId: user.id,
          instruction: text,
          targetSalespersonId: target,
        },
        include: {
          director: { select: { id: true, name: true } },
          targetSalesperson: { select: { id: true, name: true } },
        },
      });

      // Let the salesperson know about a director's note
      if (target && target !== user.id) {
        await tx.notification.create({
          data: {
            userId: target,
            title: `Note from ${user.name}`,
            message: text,
            type: NotificationType.DIRECTOR_INSTRUCTION,
            deliveries: {
              create: [{ channel: 'IN_APP', status: 'SENT', attempts: 1 }],
            },
          },
        });
      }

      return c;
    });

    return NextResponse.json({ success: true, comment });
  } catch (error: any) {
    return errorResponse(error);
  }
}
