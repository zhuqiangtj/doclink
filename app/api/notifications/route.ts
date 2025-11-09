import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';


// GET notifications for the logged-in doctor
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const doctorProfile = await prisma.doctor.findUnique({
      where: { userId: session.user.id },
    });

    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const notifications = await prisma.notification.findMany({
      where: { doctorId: doctorProfile.id },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to the last 50 notifications
    });

// 获取预约详细信息
    const notificationsWithAppointments = await Promise.all(
      notifications.map(async (notification) => {
        if (notification.appointmentId) {
          try {
            const appointment = await prisma.appointment.findUnique({
              where: { id: notification.appointmentId },
              include: {
                schedule: { select: { date: true } },
                room: { select: { name: true } }
              }
            });
            return { ...notification, appointment };
          } catch (error) {
            return notification;
          }
        }
        return notification;
      })
    );

    const unreadCount = await prisma.notification.count({
      where: {
        doctorId: doctorProfile.id,
        isRead: false,
      },
    });

    return NextResponse.json({ 
      notifications: notificationsWithAppointments, 
      unreadCount 
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) notifications to mark them as read
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { notificationIds } = await request.json();
    if (!notificationIds || !Array.isArray(notificationIds)) {
      return NextResponse.json({ error: 'Invalid request body, expected notificationIds array.' }, { status: 400 });
    }

    const doctorProfile = await prisma.doctor.findUnique({
      where: { userId: session.user.id },
    });

    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    // Ensure the doctor can only mark their own notifications as read
    const count = await prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        doctorId: doctorProfile.id,
      },
      data: {
        isRead: true,
      },
    });

    return NextResponse.json({ message: `${count.count} notifications marked as read.` });

  } catch (error) {
    console.error('Error marking notifications as read:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
