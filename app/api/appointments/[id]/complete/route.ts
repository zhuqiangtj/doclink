import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { createAuditLog } from '../../../../lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appointmentId = params.id;
  const { bedId } = await request.json();

  if (!bedId || typeof bedId !== 'number' || bedId <= 0) {
    return NextResponse.json({ error: 'A valid Bed ID is required.' }, { status: 400 });
  }

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new Error('Appointment not found.');
    }

    const doctorProfile = await prisma.doctor.findFirst({
        where: { userId: session.user.id }
    });

    if (appointment.doctorId !== doctorProfile?.id) {
      throw new Error('Forbidden: You can only complete your own appointments.');
    }

    if (appointment.status !== 'CONFIRMED') {
      throw new Error('Only confirmed appointments can be completed.');
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'COMPLETED',
        bedId: bedId,
      },
       include: {
            patient: { select: { name: true } },
            room: { select: { name: true } },
            schedule: { select: { date: true } },
        }
    });
    
    await createAuditLog(session, 'DOCTOR_COMPLETE_APPOINTMENT', 'Appointment', appointmentId, { bedId });

    const formattedAppointment = {
        ...updatedAppointment,
        date: updatedAppointment.schedule.date,
    };

    return NextResponse.json(formattedAppointment);

  } catch (error) {
    console.error(`Error completing appointment ${appointmentId}:`, error);
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
