import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';


// GET notifications for the logged-in patient
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'PATIENT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const appointmentId = url.searchParams.get('appointmentId');
    if (appointmentId) {
      const one = await prisma.patientNotification.findFirst({
        where: { userId: session.user.id, appointmentId },
        orderBy: { createdAt: 'desc' },
      });
      if (!one) {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
      }
      return NextResponse.json(one);
    }

    const notifications = await prisma.patientNotification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(notifications);

  } catch (error) {
    console.error('Error fetching patient notifications:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) notifications to mark them as read
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'PATIENT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { notificationIds } = await request.json();
    if (!notificationIds || !Array.isArray(notificationIds)) {
      return NextResponse.json({ error: 'Invalid request body, expected notificationIds array.' }, { status: 400 });
    }

    // Ensure the patient can only mark their own notifications as read
    const count = await prisma.patientNotification.updateMany({
      where: {
        id: { in: notificationIds },
        userId: session.user.id,
      },
      data: {
        isRead: true,
      },
    });

    return NextResponse.json({ message: `${count.count} notifications marked as read.` });

  } catch (error) {
    console.error('Error marking patient notifications as read:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
