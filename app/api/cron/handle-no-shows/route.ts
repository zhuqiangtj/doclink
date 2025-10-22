import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { createAuditLog } from '../../../lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

export async function GET(request: Request) {
  // --- Authorization ---
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // --- Logic ---
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toISOString().split('T')[0];

    // Find all appointments from yesterday that were not confirmed or completed
    const appointmentsToMarkAsNoShow = await prisma.appointment.findMany({
      where: {
        schedule: {
          date: yesterdayString,
        },
        status: {
          in: ['pending', 'CHECKED_IN'],
        },
      },
    });

    if (appointmentsToMarkAsNoShow.length === 0) {
      return NextResponse.json({ message: 'No appointments to mark as no-show.' });
    }

    let updatedCount = 0;

    // Use a transaction to update all records
    await prisma.$transaction(async (tx) => {
      for (const appointment of appointmentsToMarkAsNoShow) {
        // Update appointment status
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { status: 'NO_SHOW' },
        });

        // Decrement patient's credibility score
        await tx.patient.update({
          where: { id: appointment.patientId },
          data: { credibilityScore: { decrement: 5 } },
        });
        updatedCount++;
        await createAuditLog(null, 'CRON_NO_SHOW_PROCESSING', 'Appointment', appointment.id, { oldStatus: appointment.status, newStatus: 'NO_SHOW', patientId: appointment.patientId, credibilityChange: -5 });
      }
    });

    return NextResponse.json({ 
      message: `Successfully processed no-shows.`, 
      updatedCount 
    });

  } catch (error) {
    console.error('Cron job for handling no-shows failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
