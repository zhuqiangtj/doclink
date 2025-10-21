import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

interface TimeSlot {
  time: string;
  total: number;
  booked: number;
}

// POST a new appointment (book a slot)
export async function POST(request: Request) {
  try {
    const {
      userId,
      patientId,
      doctorId,
      scheduleId,
      time, // e.g., "09:00"
      roomId,
    } = await request.json();

    if (!userId || !patientId || !doctorId || !scheduleId || !time || !roomId) {
      return NextResponse.json({ error: 'Missing required appointment data' }, { status: 400 });
    }

    // Use a transaction to ensure data consistency
    const result = await prisma.$transaction(async (tx) => {
      // 1. Find the schedule to lock it for the transaction
      const schedule = await tx.schedule.findUnique({
        where: { id: scheduleId },
      });

      if (!schedule) {
        throw new Error('Schedule not found.');
      }

      // 2. Find the specific time slot and check availability
      const timeSlots = schedule.timeSlots as unknown as TimeSlot[];
      const targetSlot = timeSlots.find(slot => slot.time === time);

      if (!targetSlot) {
        throw new Error('Time slot not found in schedule.');
      }

      if (targetSlot.booked >= targetSlot.total) {
        throw new Error('This time slot is fully booked.');
      }

      // 3. Increment the booked count
      targetSlot.booked += 1;
      const newBedId = targetSlot.booked; // Assign the next available bed number

      // 4. Update the schedule with the new booked count
      await tx.schedule.update({
        where: { id: scheduleId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { timeSlots: timeSlots as any },
      });

      // 5. Create the appointment record
      const newAppointment = await tx.appointment.create({
        data: {
          userId,
          patientId,
          doctorId,
          scheduleId,
          time,
          roomId,
          bedId: newBedId,
          status: 'pending', // As per the README
        },
      });

      return newAppointment;
    });

    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    console.error('Error creating appointment:', error);
    const message = error instanceof Error ? error.message : 'Failed to create appointment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
