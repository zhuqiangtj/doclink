import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

// GET all doctors
export async function GET() {
  try {
    const doctors = await prisma.doctor.findMany({
      include: {
        rooms: true, // Include the rooms they are associated with
      },
    });
    return NextResponse.json(doctors);
  } catch (error) {
    console.error('Error fetching doctors:', error);
    return NextResponse.json({ error: 'Failed to fetch doctors' }, { status: 500 });
  }
}

// POST a new doctor
export async function POST(request: Request) {
  try {
    const { name, accountId, roomIds } = await request.json();

    if (!name || !accountId || !roomIds || !Array.isArray(roomIds)) {
      return NextResponse.json({ error: 'Missing name, accountId, or roomIds' }, { status: 400 });
    }

    const newDoctor = await prisma.doctor.create({
      data: {
        name,
        accountId,
        rooms: {
          connect: roomIds.map((id: string) => ({ id })),
        },
      },
      include: {
        rooms: true,
      },
    });

    return NextResponse.json(newDoctor, { status: 201 });
  } catch (error) {
    console.error('Error creating doctor:', error);
    // Handle potential errors, e.g., if an accountId is not unique
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
       return NextResponse.json({ error: 'Account ID already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create doctor' }, { status: 500 });
  }
}
