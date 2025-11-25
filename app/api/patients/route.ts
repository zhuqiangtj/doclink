import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';


// GET patients (for doctors to search)
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
  const searchQuery = searchParams.get('search');

  const isCJK = !!searchQuery && /[\u3400-\u9FFF]/.test(searchQuery);
  if (!searchQuery || (!isCJK && searchQuery.length < 2)) {
    return NextResponse.json({ error: 'A search query with at least 2 characters is required.' }, { status: 400 });
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
        credibilityScore: true,
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            phone: true,
            gender: true,
            dateOfBirth: true,
          },
        },
      },
      take: 10, // Limit the number of results
    });

    // Format the response to be flatter and more convenient for the frontend
    const formattedPatients = patients.map(p => ({
      id: p.id,
      userId: p.user.id,
      username: p.user.username,
      name: p.user.name,
      phone: p.user.phone ?? null,
      credibilityScore: p.credibilityScore,
      gender: p.user.gender ?? null,
      dateOfBirth: p.user.dateOfBirth ? p.user.dateOfBirth.toISOString() : null,
    }));

    return NextResponse.json(formattedPatients);

  } catch (error) {
    console.error('Error searching for patients:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
