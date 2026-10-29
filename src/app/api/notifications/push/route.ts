import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJson } from '@/lib/inputValidation';
import { errorResponse } from '@/lib/apiErrors';
import { pushPublicKey, sendPush } from '@/lib/notify';

/** The server's public push key, which a phone needs to turn on notifications. */
export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ publicKey: pushPublicKey() });
  } catch (error: any) {
    return errorResponse(error);
  }
}

/**
 * Turn on phone notifications for this device ({ subscription }), or send a test message to every device of
 * the signed-in person ({ test: true }). A device signed in by someone else before now belongs to this person.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await readJson(request);
    if (body.test) {
      const reached = await sendPush([user.id], { title: 'Notifications are on', body: 'This is how CRM notifications will appear on this device.', link: '/dashboard', tag: `test-${Date.now()}` });
      return reached ? NextResponse.json({ success: true, reached }) : NextResponse.json({ error: 'No device with notifications turned on was reached' }, { status: 400 });
    }
    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') {
      return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 });
    }
    const device = { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: String(request.headers.get('user-agent') || '').slice(0, 300) || null };
    await prisma.pushSubscription.upsert({ where: { endpoint: sub.endpoint }, update: device, create: { endpoint: sub.endpoint, ...device } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}

/** Turn off phone notifications for this device. */
export async function DELETE(request: Request) {
  try {
    const user = await requireAuth();
    const body = await readJson(request);
    if (typeof body.endpoint === 'string') await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}
