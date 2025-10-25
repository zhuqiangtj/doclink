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
  const { action } = await request.json(); // action: 'CONFIRM' | 'DENY'

  if (!['CONFIRM', 'DENY'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
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

      let newStatus: string;
      let auditAction: string;

      if (action === 'CONFIRM') {
        // Find the next available bed ID
        const appointmentsInRoom = await tx.appointment.findMany({
          where: { 
            roomId: appointment.roomId,
            status: 'CONFIRMED', // Only consider confirmed appointments for bed occupation
            schedule: { date: appointment.schedule.date },
          },
          select: { bedId: true },
        });
        const occupiedBeds = new Set(appointmentsInRoom.map(a => a.bedId));
        const room = await tx.room.findUnique({ where: { id: appointment.roomId } });
        let assignedBedId = 0;
        for (let i = 1; i <= (room?.bedCount || 0); i++) {
          if (!occupiedBeds.has(i)) {
            assignedBedId = i;
            break;
          }
        }
        if (assignedBedId === 0) {
          throw new Error('No available beds in this room.');
        }

        newStatus = 'CONFIRMED';
        auditAction = 'DOCTOR_CONFIRM_CHECK_IN';
        // Award credibility score and assign bed
        await tx.patient.update({
          where: { id: appointment.patientId },
          data: { credibilityScore: { increment: 1 } },
        });
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { status: newStatus, bedId: assignedBedId },
        });
      } else { // DENY
        newStatus = 'pending'; // Revert status to allow re-check-in
        auditAction = 'DOCTOR_DENY_CHECK_IN';
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { status: newStatus },
        });
      }

      const result = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
            patient: { select: { name: true } },
            room: { select: { name: true } },
            schedule: { select: { date: true } },
        }
      });
      await createAuditLog(session, auditAction, 'Appointment', appointmentId, { oldStatus: appointment.status, newStatus, patientId: appointment.patientId });
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
