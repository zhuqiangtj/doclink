import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';

const prisma = new PrismaClient();

// GET patients (for doctors to search)
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const searchQuery = searchParams.get('search');

  if (!searchQuery || searchQuery.length < 2) {
    return NextResponse.json({ error: 'A search query with at least 2 characters is required.' }, { status: 400 });
  }

  try {
    const patients = await prisma.patient.findMany({
      where: {
        OR: [
          {
            name: {
              contains: searchQuery,
              mode: 'insensitive', // Case-insensitive search
            },
          },
          {
            user: {
              email: {
                contains: searchQuery,
                mode: 'insensitive',
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        user: {
          select: {
            id: true, // User ID is needed for creating the appointment
            email: true,
          },
        },
      },
      take: 10, // Limit the number of results
    });

    // Format the response to be flatter and more convenient for the frontend
    const formattedPatients = patients.map(p => ({
      id: p.id, // This is the Patient ID
      userId: p.user.id, // This is the User ID
      name: p.name,
      email: p.user.email,
    }));

    return NextResponse.json(formattedPatients);

  } catch (error) {
    console.error('Error searching for patients:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
