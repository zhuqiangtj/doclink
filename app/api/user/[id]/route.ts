import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const { id } = params;

  console.log(`[API_USER] Received request for user ID: ${id}`);

  if (!session) {
    console.error('[API_USER] Unauthorized: No session found.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.id !== id && session.user.role !== 'ADMIN') {
    console.error(`[API_USER] Forbidden: User ${session.user.id} cannot access profile of ${id}.`);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    console.log(`[API_USER] Executing Prisma findUnique for user ID: ${id}`);
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        patientProfile: true,
        doctorProfile: {
          include: {
            Room: true,
          },
        },
      },
    });

    if (!user) {
      console.error(`[API_USER] User not found in database for ID: ${id}`);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log(`[API_USER] Successfully found user: ${user.username}`);

    // IMPORTANT: Exclude password from the response for security
    const { password, ...userWithoutPassword } = user;

    return NextResponse.json(userWithoutPassword);

  } catch (error) {
    console.error(`[API_USER] Critical error fetching user ${id}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
