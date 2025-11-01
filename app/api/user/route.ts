import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);

  console.log(`[API_USER] Received request for current user profile`);

  if (!session) {
    console.error('[API_USER] Unauthorized: No session found.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log(`[API_USER] Executing Prisma findUnique for current user ID: ${session.user.id}`);
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
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
      console.error(`[API_USER] User not found in database for ID: ${session.user.id}`);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log(`[API_USER] Successfully found user: ${user.username}`);

    // IMPORTANT: Exclude password from the response for security
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;

    return NextResponse.json(userWithoutPassword);

  } catch (error) {
    console.error(`[API_USER] Critical error fetching current user:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}