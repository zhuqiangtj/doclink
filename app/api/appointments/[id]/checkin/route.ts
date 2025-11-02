import { NextResponse, NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit'; // Adjust path as needed
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const { params } = context;
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'PATIENT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: appointmentId } = await params; // Await params for Next.js 15 compatibility

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // Authorization: Ensure the appointment belongs to the logged-in user
    if (appointment.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Logic: Only allow check-in for pending appointments on the same day
    const today = new Date();
    const appointmentDate = new Date(appointment.createTime); // Assuming date is stored on schedule
    const isSameDay = today.getFullYear() === appointmentDate.getFullYear() &&
                      today.getMonth() === appointmentDate.getMonth() &&
                      today.getDate() === appointmentDate.getDate();

    if (appointment.status !== 'pending' || !isSameDay) {
        return NextResponse.json({ error: 'Check-in is not available for this appointment at this time.' }, { status: 400 });
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { 
        status: 'CHECKED_IN',
        reason: '病人已報到'
      },
    });

    await createAuditLog(session, 'PATIENT_CHECK_IN', 'Appointment', appointmentId);
    return NextResponse.json(updatedAppointment);

  } catch (error) {
    console.error(`Error checking in for appointment ${appointmentId}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
