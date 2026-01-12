import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { authOptions } from '../../../api/auth/[...nextauth]/route';

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const search = searchParams.get('search') || '';

  const skip = (page - 1) * limit;

  try {
    const where: any = {};
    if (search) {
      where.user = {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      };
    }

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              name: true,
              gender: true,
              dateOfBirth: true,
              phone: true,
            },
          },
          appointments: {
            select: {
              status: true,
            },
          },
        },
      }),
      prisma.patient.count({ where }),
    ]);

    const formattedPatients = patients.map((patient) => {
      const visitCount = patient.appointments.filter(
        (a) => a.status === 'COMPLETED'
      ).length;
      const noShowCount = patient.appointments.filter(
        (a) => a.status === 'NO_SHOW'
      ).length;

      const birthDate = patient.user.dateOfBirth;
      let age = null;
      if (birthDate) {
        const today = new Date();
        const birth = new Date(birthDate);
        age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
          age--;
        }
      }

      return {
        id: patient.id,
        name: patient.user.name,
        gender: patient.user.gender,
        age,
        phone: patient.user.phone,
        credibilityScore: patient.credibilityScore,
        visitCount,
        noShowCount,
        totalAppointments: patient.appointments.length,
      };
    });

    return NextResponse.json({
      patients: formattedPatients,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error fetching patients:', error);
    return NextResponse.json(
      { error: 'Failed to fetch patients' },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
