import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only DOCTOR and ADMIN can view patient details
  if (session.user.role !== 'DOCTOR' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: patientId } = await context.params;

  try {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            phone: true,
            gender: true,
            dateOfBirth: true,
          }
        },
        appointments: {
          orderBy: {
            date: 'desc'
          },
          select: {
            id: true,
            date: true,
            time: true,
            status: true
          }
        }
      }
    });

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    
    // Calculate stats
    const visitCount = patient.appointments.filter(a => a.status === 'COMPLETED').length;
    const noShowCount = patient.appointments.filter(a => a.status === 'NO_SHOW').length;
    const totalAppointments = patient.appointments.length;
    
    // Calculate Age
    let age = null;
    if (patient.user.dateOfBirth) {
       const today = new Date();
       const birthDate = new Date(patient.user.dateOfBirth);
       age = today.getFullYear() - birthDate.getFullYear();
       const m = today.getMonth() - birthDate.getMonth();
       if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
           age--;
       }
    }

    // Format response to match PatientData interface and separate appointments
    const formattedPatient = {
      id: patient.id,
      name: patient.user.name,
      gender: patient.user.gender,
      age,
      phone: patient.user.phone,
      credibilityScore: patient.credibilityScore,
      visitCount,
      noShowCount,
      totalAppointments,
    };

    return NextResponse.json({
      patient: formattedPatient,
      appointments: patient.appointments
    });

  } catch (error) {
    console.error('Error fetching patient:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

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
