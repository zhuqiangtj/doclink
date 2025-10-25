import { PrismaClient } from '@prisma/client';
import { NextResponse, NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appointmentId = params.id;
  const { action, bedId } = await request.json(); // action: 'CONFIRM' | 'DENY', bedId?: number

  if (!['CONFIRM', 'DENY'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  if (action === 'CONFIRM' && (bedId === undefined || bedId <= 0)) {
    return NextResponse.json({ error: 'Valid Bed ID is required for confirmation.' }, { status: 400 });
  }

  try {
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { patient: true },
      });

      if (!appointment) {
        throw new Error('Appointment not found.');
      }

      const doctorProfile = await tx.doctor.findFirst({
          where: { userId: session.user.id }
      });

      if (appointment.doctorId !== doctorProfile?.id) {
        throw new Error('Forbidden: You can only confirm your own appointments.');
      }

      if (appointment.status !== 'CHECKED_IN') {
        throw new Error('This appointment has not been checked in by the patient.');
      }

      let auditAction: string;
      const dataToUpdate: { status: string; bedId?: number } = { status: '' };

      if (action === 'CONFIRM') {
        dataToUpdate.status = 'CONFIRMED';
        dataToUpdate.bedId = bedId;
        auditAction = 'DOCTOR_CONFIRM_CHECK_IN';
        // Award credibility score
        await tx.patient.update({
          where: { id: appointment.patientId },
          data: { credibilityScore: { increment: 1 } },
        });

        // Create a notification for the patient
        const doctorUser = await tx.user.findUnique({ where: { id: session.user.id } });
        if (doctorUser) {
          await tx.patientNotification.create({
            data: {
              userId: appointment.userId,
              appointmentId: appointment.id,
              doctorName: doctorUser.name,
              message: `您的预约已确认，床位号为: ${bedId}`,
              type: 'APPOINTMENT_CONFIRMED_BY_DOCTOR',
            },
          });
        }
      } else { // DENY
        dataToUpdate.status = 'pending'; // Revert status to allow re-check-in
        auditAction = 'DOCTOR_DENY_CHECK_IN';
      }

      const result = await tx.appointment.update({
        where: { id: appointmentId },
        data: dataToUpdate,
        include: {
            patient: { select: { name: true } },
            room: { select: { name: true } },
            schedule: { select: { date: true } },
        }
      });

      await createAuditLog(session, auditAction, 'Appointment', appointmentId, { oldStatus: appointment.status, newStatus: dataToUpdate.status, patientId: appointment.patientId, assignedBed: bedId });
      return result;
    });
    
    const formattedAppointment = {
        ...updatedAppointment,
        date: updatedAppointment.schedule.date,
    };

    return NextResponse.json(formattedAppointment);

  } catch (error) {
    console.error(`Error confirming check-in for appointment ${appointmentId}:`, error);
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
