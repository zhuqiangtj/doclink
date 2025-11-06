import { NextResponse, NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { createAuditLog } from '../../../../../lib/audit'; // Adjust path as needed
import { prisma } from '../../../../../lib/prisma';
import { createAppointmentHistory } from '../../../../../lib/appointment-history';

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

    // 僅允許當天且當前狀態為 PENDING 的預約可報到
    if (appointment.status !== 'PENDING' || !isSameDay) {
        return NextResponse.json({ error: 'Check-in is not available for this appointment at this time.' }, { status: 400 });
    }
    // 不再更新預約記錄的狀態為 CHECKED_IN，僅記錄報到行為
    const updatedAppointment = appointment;

    // 創建預約歷史記錄
    await createAppointmentHistory({
      appointmentId: appointmentId,
      operatorName: session.user.name || session.user.username || 'Unknown',
      operatorId: session.user.id,
      // 保留當前預約狀態（四狀態之一），只記錄報到行為
      status: appointment.status,
      reason: '病人已報到',
      action: 'CHECKIN',
    });

    await createAuditLog(session, 'PATIENT_CHECK_IN', 'Appointment', appointmentId);
    return NextResponse.json(updatedAppointment);

  } catch (error) {
    console.error(`Error checking in for appointment ${appointmentId}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
