import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only DOCTOR and ADMIN can update patient details
  if (session.user.role !== 'DOCTOR' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: patientId } = await context.params;
  
  try {
    const body = await request.json();
    const { credibilityScore } = body;

    if (credibilityScore === undefined || typeof credibilityScore !== 'number') {
      return NextResponse.json({ error: 'Valid credibilityScore is required' }, { status: 400 });
    }

    // Check if patient exists
    const existingPatient = await prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!existingPatient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const updatedPatient = await prisma.patient.update({
      where: { id: patientId },
      data: {
        credibilityScore: credibilityScore,
      },
    });

    // Audit Log
    await createAuditLog(
      session,
      'UPDATE_PATIENT_CREDIBILITY',
      'Patient',
      patientId,
      {
        oldScore: existingPatient.credibilityScore,
        newScore: credibilityScore,
        updatedBy: session.user.id
      }
    );

    return NextResponse.json(updatedPatient);

  } catch (error) {
    console.error('Error updating patient:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
