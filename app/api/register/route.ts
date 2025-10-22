import { PrismaClient, Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { createAuditLog } from '@/lib/audit'; // Adjust path as needed

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const { username, name, phone, dateOfBirth, gender, password } = await request.json();

    if (!username || !name || !phone || !dateOfBirth || !gender || !password) {
      return NextResponse.json({ error: 'Missing required fields for patient registration.' }, { status: 400 });
    }

    const existingUserByUsername = await prisma.user.findUnique({
      where: { username },
    });
    if (existingUserByUsername) {
      return NextResponse.json({ error: 'Username already in use' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username,
          name,
          phone,
          dateOfBirth: new Date(dateOfBirth), // Convert to Date object
          gender,
          password: hashedPassword,
          role: Role.PATIENT, // Always register as a PATIENT
        },
      });

      await tx.patient.create({
        data: {
          userId: newUser.id,
          // name and phone are now on the User model
        },
      });
      return newUser;
    });

    // Log the registration action
    await createAuditLog(null, 'REGISTER_PATIENT', 'User', user.id, { username: user.username, name: user.name, role: user.role });

    // Don't return the password hash in the response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json(userWithoutPassword, { status: 201 });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}