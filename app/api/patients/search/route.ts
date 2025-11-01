import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient();

// GET patients search (for doctors to search)
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Allow both DOCTOR and ADMIN roles to search patients
  if (session.user.role !== 'DOCTOR' && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden: Doctor or Admin access required' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const searchQuery = searchParams.get('q');

  if (!searchQuery || searchQuery.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const patients = await prisma.patient.findMany({
      where: {
        OR: [
          {
            user: {
              username: {
                contains: searchQuery,
                mode: 'insensitive', // Case-insensitive search
              },
            },
          },
          {
            user: {
              name: {
                contains: searchQuery,
                mode: 'insensitive',
              },
            },
          },
        ],
      },
      select: {
        id: true,
        user: {
          select: {
            id: true, // User ID is needed for creating the appointment
            username: true,
            name: true,
          },
        },
      },
      take: 10, // Limit the number of results
    });

    // Format the response to be flatter and more convenient for the frontend
    const formattedPatients = patients.map(p => ({
      id: p.id, // This is the Patient ID
      userId: p.user.id, // This is the User ID
      username: p.user.username,
      name: p.user.name,
    }));

    return NextResponse.json(formattedPatients);

  } catch (error) {
    console.error('Error searching for patients:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}