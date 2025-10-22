import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const adminUser = await prisma.user.findUnique({
      where: { username: 'admin' },
    });

    if (!adminUser) {
      return NextResponse.json({ message: 'Admin user not found in DB.' }, { status: 404 });
    }

    // IMPORTANT: Do NOT return the password hash in a real debug endpoint.
    // For this temporary diagnostic, we'll return it to check its presence.
    const { password, ...userWithoutPassword } = adminUser;

    return NextResponse.json({ ...userWithoutPassword, passwordHash: password });

  } catch (error) {
    console.error('Error fetching admin user for debug:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
