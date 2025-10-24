import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient();

// GET user profile by ID
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const { id } = params;

  if (!session || (session.user.id !== id && session.user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        patientProfile: true, // Include full patient profile
                  doctorProfile: {
                    include: {
                      Room: true, // For doctors, include their rooms
                    },
                  },      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Exclude password from the response
    const { password, ...userWithoutPassword } = user;

    return NextResponse.json(userWithoutPassword);

  } catch (error) {
    console.error(`Error fetching user ${id}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
