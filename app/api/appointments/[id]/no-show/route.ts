import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit';

const prisma = new PrismaClient();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appointmentId = params.id;

  try {
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) throw new Error('Appointment not found.');

      // Authorization: Doctor can only mark their own appointments
      const doctorProfile = await tx.doctor.findUnique({ where: { userId: session.user.id } });
      if (appointment.doctorId !== doctorProfile?.id) {
        throw new Error('Forbidden: You can only modify your own appointments.');
      }

      // Update appointment status to NO_SHOW
      const result = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'NO_SHOW' },
      });

      // Decrement patient's credibility score
      await tx.patient.update({
        where: { id: appointment.patientId },
        data: { credibilityScore: { decrement: 5 } },
      });

      await createAuditLog(session, 'DOCTOR_MARK_NO_SHOW', 'Appointment', appointmentId, { patientId: appointment.patientId, oldStatus: appointment.status });
      return result;
    });

    return NextResponse.json(updatedAppointment);

  } catch (error) {
    console.error(`Error marking appointment ${appointmentId} as no-show:`, error);
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
