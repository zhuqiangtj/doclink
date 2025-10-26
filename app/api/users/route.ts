import { PrismaClient, Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import bcrypt from 'bcrypt';
import { createAuditLog } from '@/lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

// GET all users (Admin only)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      include: {
        patientProfile: { select: { id: true, credibilityScore: true, isSuspended: true } },
        doctorProfile: { include: { Room: true } },
      },
      orderBy: {
        username: 'asc',
      },
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST (create) a new user (Admin only)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { name, username: initialUsername, phone, dateOfBirth, gender, password, role } = await request.json();
    if (!name || !initialUsername || !password || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Role-specific required fields
    if (role === 'PATIENT' && (!phone || !dateOfBirth || !gender)) {
      return NextResponse.json({ error: 'Patient registration requires phone, dateOfBirth, and gender.' }, { status: 400 });
    }
    if ((role === 'DOCTOR' || role === 'ADMIN') && !gender) {
      return NextResponse.json({ error: 'Doctor/Admin registration requires gender.' }, { status: 400 });
    }

    if (!Object.values(Role).includes(role)) {
      return NextResponse.json({ error: 'Invalid role specified' }, { status: 400 });
    }

    let finalUsername = initialUsername;
    let counter = 1;
    while (await prisma.user.findUnique({ where: { username: finalUsername } })) {
      finalUsername = `${initialUsername}${counter}`;
      counter++;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: finalUsername,
          name,
          phone,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          gender,
          password: hashedPassword,
          role,
        },
      });

      if (role === 'PATIENT') {
        await tx.patient.create({
          data: {
            userId: user.id,
          },
        });
      } else if (role === 'DOCTOR') {
        await tx.doctor.create({
          data: {
            userId: user.id,
          },
        });
      }
      // Admins don't have a separate profile table

      return user;
    });

    await createAuditLog(session, 'ADMIN_CREATE_USER', 'User', newUser.id, { username: newUser.username, name: newUser.name, role: newUser.role });
    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) a user (Admin only)
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    const { name, phone, dateOfBirth, gender, role, credibilityScore, isSuspended, password } = await request.json();

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found.');

      // Handle password reset separately as it returns early
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await tx.user.update({
          where: { id: userId },
          data: { password: hashedPassword },
        });
        await createAuditLog(session, 'ADMIN_RESET_PASSWORD', 'User', userId, { byAdmin: true });
        // Since we are in a transaction, we can't return a simple object.
        // We will fetch and return the user at the end.
      } else {
        // Handle all other updates
        const userDataToUpdate: { name?: string; phone?: string; dateOfBirth?: Date; gender?: string; role?: Role } = {};
        if (name) userDataToUpdate.name = name;
        if (phone) userDataToUpdate.phone = phone;
        if (dateOfBirth) userDataToUpdate.dateOfBirth = new Date(dateOfBirth);
        if (gender) userDataToUpdate.gender = gender;
        if (role && user.role !== role) userDataToUpdate.role = role;

        if (Object.keys(userDataToUpdate).length > 0) {
          await tx.user.update({
            where: { id: userId },
            data: userDataToUpdate,
          });
          await createAuditLog(session, 'ADMIN_UPDATE_USER_DETAILS', 'User', userId, userDataToUpdate);
        }

        if (user.role === 'PATIENT') {
          const patientProfile = await tx.patient.findUnique({ where: { userId } });
          if (patientProfile) {
            const patientDataToUpdate: { credibilityScore?: number; isSuspended?: boolean } = {};
            if (credibilityScore !== undefined) patientDataToUpdate.credibilityScore = credibilityScore;
            if (isSuspended !== undefined) patientDataToUpdate.isSuspended = isSuspended;

            if (Object.keys(patientDataToUpdate).length > 0) {
              await tx.patient.update({
                where: { userId },
                data: patientDataToUpdate,
              });
              await createAuditLog(session, 'ADMIN_UPDATE_PATIENT_PROFILE', 'Patient', patientProfile.id, patientDataToUpdate);
            }
          }
        }
      }

      // Fetch the final state of the user at the end of the transaction
      return tx.user.findUnique({
        where: { id: userId },
        include: {
          patientProfile: { select: { id: true, credibilityScore: true, isSuspended: true } },
          doctorProfile: { include: { Room: true } },
        },
      });
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE a user (Admin only)
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { doctorProfile: { select: { id: true } } },
      });
      if (!user) throw new Error('User not found.');

      // Delete all related data before deleting the user
      await tx.appointment.deleteMany({ where: { userId: userId } });
      
      if (user.doctorProfile) {
        const doctorId = user.doctorProfile.id;
        await tx.schedule.deleteMany({ where: { doctorId: doctorId } });
        await tx.room.deleteMany({ where: { doctorId: doctorId } });
      }

      await tx.doctor.deleteMany({ where: { userId: userId } });
      await tx.patient.deleteMany({ where: { userId: userId } });
      await tx.account.deleteMany({ where: { userId: userId } });
      await tx.session.deleteMany({ where: { userId: userId } });

      // Finally, delete the user
      await tx.user.delete({ where: { id: userId } });

      await createAuditLog(session, 'ADMIN_DELETE_USER', 'User', userId, { username: user.username, role: user.role });
    });

    return NextResponse.json({ message: 'User deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
