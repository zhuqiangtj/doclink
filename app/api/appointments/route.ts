import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

interface TimeSlot {
  time: string;
  total: number;
  booked: number;
}

// GET appointments (for doctors or patients)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    console.error('[API_APPOINTMENTS] Unauthorized attempt to fetch appointments.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  console.log(`[API_APPOINTMENTS] User ${session.user.username} (${session.user.role}) is fetching appointments.`);

  try {
    const whereClause: { doctorId?: string; patientId?: string; status?: string; schedule?: { date: string } } = {};

    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { doctorProfile: true } });
      if (!userProfile?.doctorProfile) return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
      whereClause.doctorId = userProfile.doctorProfile.id;

    } else if (session.user.role === 'PATIENT') {
       const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { patientProfile: true } });
       if (!userProfile?.patientProfile) return NextResponse.json({ error: 'Patient profile not found' }, { status: 404 });
      whereClause.patientId = userProfile.patientProfile.id;
    }

    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      include: {
        patient: { include: { user: { select: { name: true } } } },
        doctor: { include: { user: { select: { name: true } } } },
        room: { select: { name: true } },
        schedule: { select: { date: true } }, // Get date from schedule
      },
      orderBy: {
        createTime: 'desc',
      },
    });

    // Remap to include date directly for easier frontend consumption
    const formattedAppointments = appointments.map(apt => ({
      ...apt,
      date: apt.schedule.date,
    }));

    return NextResponse.json(formattedAppointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


// POST a new appointment (book a slot)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { userId, patientId, doctorId, scheduleId, time, roomId } = await request.json();

    // Authorization check: Patients can only book for themselves. Doctors can book for any patient.
    if (session.user.role === 'PATIENT' && session.user.id !== userId) {
      return NextResponse.json({ error: 'Forbidden: Patients can only book appointments for themselves.' }, { status: 403 });
    }
    // Further validation can be added for doctors if needed

    if (!userId || !patientId || !doctorId || !scheduleId || !time || !roomId) {
      return NextResponse.json({ error: 'Missing required appointment data' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // First, fetch the schedule to get timeSlots
      const schedule = await tx.schedule.findUnique({
        where: { id: scheduleId },
      });
      
      if (!schedule) {
        throw new Error('Schedule not found.');
      }

      const timeSlots = schedule.timeSlots as TimeSlot[];
      const targetSlot = timeSlots.find(slot => slot.time === time);
      if (!targetSlot) throw new Error('Time slot not found in schedule.');
      if (targetSlot.booked >= targetSlot.total) throw new Error('This time slot is fully booked.');

      targetSlot.booked += 1;

      await tx.schedule.update({
        where: { id: scheduleId },
        data: { timeSlots: timeSlots },
      });

      const newAppointment = await tx.appointment.create({
        data: { userId, patientId, doctorId, scheduleId, time, roomId, bedId: 0, status: 'pending' }, // Set bedId to 0 initially
      });

      // Create a notification for the doctor
      const patientUser = await tx.user.findUnique({ where: { id: userId } });
      if (patientUser) {
        await tx.notification.create({
          data: {
            doctorId: doctorId,
            appointmentId: newAppointment.id,
            patientName: patientUser.name,
            message: `${patientUser.name} 预约了您在 ${time} 的号。`,
            type: 'APPOINTMENT_CREATED',
          },
        });
      }

      // Create a notification for the patient if the doctor is booking
      if (session.user.role === 'DOCTOR') {
        const doctorUser = await tx.user.findUnique({ where: { id: session.user.id } });
        if (doctorUser) {
          await tx.patientNotification.create({
            data: {
              userId: userId,
              appointmentId: newAppointment.id,
              doctorName: doctorUser.name,
              message: `医生 ${doctorUser.name} 为您安排了在 ${time} 的预约。`,
              type: 'APPOINTMENT_CREATED_BY_DOCTOR',
            },
          });
        }
      }

      return newAppointment;
    });

    await createAuditLog(session, 'CREATE_APPOINTMENT', 'Appointment', result.id, { userId, patientId, doctorId, scheduleId, time, roomId });
    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    console.error('Error creating appointment:', error);
    const message = error instanceof Error ? error.message : 'Failed to create appointment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE an appointment (cancel)
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const appointmentId = searchParams.get('appointmentId');

  if (!appointmentId) {
    return NextResponse.json({ error: 'Appointment ID is required' }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) throw new Error('Appointment not found.');

      // Authorization check
      if (session.user.role === 'DOCTOR') {
        const userProfile = await tx.user.findUnique({ where: { id: session.user.id }, include: { doctorProfile: true } });
        if (userProfile?.doctorProfile?.id !== appointment.doctorId) {
          throw new Error('Forbidden: You can only cancel your own appointments.');
        }
      } else if (session.user.role === 'PATIENT') {
        if (session.user.id !== appointment.userId) {
          throw new Error('Forbidden: You can only cancel your own appointments.');
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const appointmentDate = new Date(appointment.date);
        appointmentDate.setHours(0, 0, 0, 0);

        let penalty = 0;
        if (appointmentDate.getTime() === today.getTime()) {
          // Cancelling on the same day
          penalty = 5;
        } else if (appointmentDate > today) {
          // Cancelling before the appointment day
          penalty = 1;
        } else {
          // Trying to cancel after the appointment day has passed
          throw new Error('Forbidden: You cannot cancel an appointment that has already passed.');
        }

        const patientProfile = await tx.patient.findUnique({ where: { userId: session.user.id } });
        if (patientProfile) {
          await tx.patient.update({
            where: { id: patientProfile.id },
            data: { credibilityScore: { decrement: penalty } },
          });
        }
      } else if (session.user.role !== 'ADMIN') { // Explicitly check for Admin
        throw new Error('Forbidden: You do not have permission to cancel this appointment.');
      }

      const schedule = await tx.schedule.findUnique({ where: { id: appointment.scheduleId } });
      if (!schedule) throw new Error('Associated schedule not found.');

      const timeSlots = schedule.timeSlots as TimeSlot[];
      const targetSlot = timeSlots.find(slot => slot.time === appointment.time);
      if (targetSlot && targetSlot.booked > 0) {
        targetSlot.booked -= 1;
        await tx.schedule.update({
          where: { id: appointment.scheduleId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { timeSlots: timeSlots as any },
        });
      }

      await tx.appointment.delete({ where: { id: appointmentId } });

      // Create a notification for the doctor
      const patientUser = await tx.user.findUnique({ where: { id: appointment.userId } });
      if (patientUser) {
        await tx.notification.create({
          data: {
            doctorId: appointment.doctorId,
            appointmentId: appointment.id,
            patientName: patientUser.name,
            message: `${patientUser.name} 取消了 ${appointment.time} 的预约。`,
            type: 'APPOINTMENT_CANCELLED',
          },
        });
      }

      // Create a notification for the patient if a doctor or admin cancels
      if (session.user.role === 'DOCTOR' || session.user.role === 'ADMIN') {
        const actor = await tx.user.findUnique({ where: { id: session.user.id } });
        if (actor) {
          await tx.patientNotification.create({
            data: {
              userId: appointment.userId,
              appointmentId: appointment.id,
              doctorName: actor.name, // The actor is the doctor or admin
              message: `您的预约 (预约时间: ${appointment.time}) 已被 ${actor.name} 取消。`,
              type: 'APPOINTMENT_CANCELLED_BY_DOCTOR',
            },
          });
        }
      }

      await createAuditLog(session, 'CANCEL_APPOINTMENT', 'Appointment', appointmentId, { doctorId: appointment.doctorId, patientId: appointment.patientId, status: appointment.status });
      return { success: true };
    });

    return NextResponse.json({ message: 'Appointment cancelled successfully' });

  } catch (error) {
    console.error(`Error cancelling appointment ${appointmentId}:`, error);
    const message = error instanceof Error ? error.message : 'Failed to cancel appointment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
