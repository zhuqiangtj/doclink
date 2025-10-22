import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '../../../lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

interface TimeSlot {
  time: string;
  total: number;
  booked: number;
}

// GET appointments (for doctors or patients)
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get('doctorId');
  const patientId = searchParams.get('patientId');

  try {
    let whereClause: any = {};

    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { doctorProfile: true } });
      if (!userProfile?.doctorProfile) return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
      
      // Doctors can only get appointments for themselves
      whereClause.doctorId = userProfile.doctorProfile.id;

    } else if (session.user.role === 'PATIENT') {
       const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { patientProfile: true } });
       if (!userProfile?.patientProfile) return NextResponse.json({ error: 'Patient profile not found' }, { status: 404 });
      
      // Patients can only get appointments for themselves
      whereClause.patientId = userProfile.patientProfile.id;
    }
    
    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      include: {
        patient: { select: { name: true } },
        doctor: { select: { name: true } },
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
      const schedule = await tx.schedule.findUnique({ where: { id: scheduleId } });
      if (!schedule) throw new Error('Schedule not found.');

      const timeSlots = schedule.timeSlots as unknown as TimeSlot[];
      const targetSlot = timeSlots.find(slot => slot.time === time);
      if (!targetSlot) throw new Error('Time slot not found in schedule.');
      if (targetSlot.booked >= targetSlot.total) throw new Error('This time slot is fully booked.');

      targetSlot.booked += 1;

      await tx.schedule.update({
        where: { id: scheduleId },
        data: { timeSlots: timeSlots as any },
      });

      const newAppointment = await tx.appointment.create({
        data: { userId, patientId, doctorId, scheduleId, time, roomId, bedId: 0, status: 'pending' }, // Set bedId to 0 initially
      });

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
    const result = await prisma.$transaction(async (tx) => {
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
      } else { // Admin case
        // Admins are allowed, no specific check needed unless required
      }

      const schedule = await tx.schedule.findUnique({ where: { id: appointment.scheduleId } });
      if (!schedule) throw new Error('Associated schedule not found.');

      const timeSlots = schedule.timeSlots as unknown as TimeSlot[];
      const targetSlot = timeSlots.find(slot => slot.time === appointment.time);
      if (targetSlot && targetSlot.booked > 0) {
        targetSlot.booked -= 1;
        await tx.schedule.update({
          where: { id: appointment.scheduleId },
          data: { timeSlots: timeSlots as any },
        });
      }

      await tx.appointment.delete({ where: { id: appointmentId } });

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