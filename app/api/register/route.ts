import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { createAuditLog } from '@/lib/audit'; // Adjust path as needed


export async function POST(request: Request) {
  try {
    const { name, phone, gender, dateOfBirth, username: initialUsername, password } = await request.json();

    if (!name || !initialUsername || !gender || !dateOfBirth || !password) {
      return NextResponse.json({ error: 'Missing required fields for patient registration.' }, { status: 400 });
    }

    let finalUsername = initialUsername;
    let counter = 1;
    while (await prisma.user.findUnique({ where: { username: finalUsername } })) {
      finalUsername = `${initialUsername}${counter}`;
      counter++;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: finalUsername, // Use the guaranteed unique username
          name,
          phone,
          dateOfBirth: new Date(dateOfBirth),
          gender,
          password: hashedPassword,
          role: Role.PATIENT, // Always register as a PATIENT
        },
      });

      await tx.patient.create({
        data: {
          userId: newUser.id,
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