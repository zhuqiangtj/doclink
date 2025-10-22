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
        patientProfile: { select: { id: true, name: true, credibilityScore: true, isSuspended: true, phone: true } },
        doctorProfile: { include: { rooms: { select: { id: true, name: true } } } },
      },
      orderBy: {
        username: 'asc', // Order by username
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
    const { name, username, email, password, role } = await request.json();
    if (!name || !username || !email || !password || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!Object.values(Role).includes(role)) {
      return NextResponse.json({ error: 'Invalid role specified' }, { status: 400 });
    }

    const existingUserByUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUserByUsername) {
      return NextResponse.json({ error: 'Username already in use' }, { status: 409 });
    }

    const existingUserByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingUserByEmail) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          password: hashedPassword,
          role,
        },
      });

      if (role === 'PATIENT') {
        await tx.patient.create({
          data: {
            name,
            userId: user.id,
          },
        });
      } else if (role === 'DOCTOR') {
        await tx.doctor.create({
          data: {
            name,
            userId: user.id,
            // Rooms are now assigned to doctors via the Room model, not here
          },
        });
      }
      // Admins don't have a separate profile table

      return user;
    });

    await createAuditLog(session, 'ADMIN_CREATE_USER', 'User', newUser.id, { username: newUser.username, email: newUser.email, role: newUser.role });
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
    const { name, username, email, role, credibilityScore, isSuspended, password } = await request.json();

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found.');

      // Update password if provided (for reset)
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await tx.user.update({
          where: { id: userId },
          data: { password: hashedPassword },
        });
        await createAuditLog(session, 'ADMIN_RESET_PASSWORD', 'User', userId, { byAdmin: true });
        return { id: userId, message: 'Password reset successfully' };
      }

      // Update username if provided and changed
      if (username && username !== user.username) {
        const existingUserWithUsername = await tx.user.findUnique({ where: { username } });
        if (existingUserWithUsername && existingUserWithUsername.id !== userId) {
          throw new Error('Username already in use.');
        }
        await tx.user.update({
          where: { id: userId },
          data: { username },
        });
        await createAuditLog(session, 'ADMIN_UPDATE_USERNAME', 'User', userId, { oldUsername: user.username, newUsername: username });
      }

      // Update email if provided and changed
      if (email && email !== user.email) {
        const existingUserWithEmail = await tx.user.findUnique({ where: { email } });
        if (existingUserWithEmail && existingUserWithEmail.id !== userId) {
          throw new Error('Email already in use.');
        }
        await tx.user.update({
          where: { id: userId },
          data: { email },
        });
        await createAuditLog(session, 'ADMIN_UPDATE_EMAIL', 'User', userId, { oldEmail: user.email, newEmail: email });
      }

      // Update user role if changed
      if (role && user.role !== role) {
        await tx.user.update({
          where: { id: userId },
          data: { role },
        });
        await createAuditLog(session, 'ADMIN_UPDATE_USER_ROLE', 'User', userId, { oldRole: user.role, newRole: role });
      }

      // Update patient profile if applicable
      if (user.role === 'PATIENT') {
        const patientProfile = await tx.patient.findUnique({ where: { userId } });
        if (patientProfile) {
          await tx.patient.update({
            where: { userId },
            data: { 
              name: name || patientProfile.name,
              credibilityScore: credibilityScore !== undefined ? credibilityScore : patientProfile.credibilityScore,
              isSuspended: isSuspended !== undefined ? isSuspended : patientProfile.isSuspended,
            },
          });
          await createAuditLog(session, 'ADMIN_UPDATE_PATIENT_PROFILE', 'Patient', patientProfile.id, { userId, name, credibilityScore, isSuspended });
        }
      }

      // Update doctor profile if applicable
      if (user.role === 'DOCTOR') {
        const doctorProfile = await tx.doctor.findUnique({ where: { userId } });
        if (doctorProfile) {
          await tx.doctor.update({
            where: { userId },
            data: {
              name: name || doctorProfile.name,
              // Rooms are now assigned to doctors via the Room model, not here
            },
          });
          await createAuditLog(session, 'ADMIN_UPDATE_DOCTOR_PROFILE', 'Doctor', doctorProfile.id, { userId, name });
        }
      }

      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        include: {
          patientProfile: { select: { id: true, name: true, credibilityScore: true, isSuspended: true, phone: true } },
          doctorProfile: { include: { rooms: { select: { id: true, name: true } } } },
        },
      });

      return updatedUser;
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
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found.');

      // Delete associated profiles first
      if (user.role === 'PATIENT') {
        await tx.patient.delete({ where: { userId } });
      } else if (user.role === 'DOCTOR') {
        await tx.doctor.delete({ where: { userId } });
      }

      await tx.user.delete({ where: { id: userId } });
      await createAuditLog(session, 'ADMIN_DELETE_USER', 'User', userId, { email: user.email, role: user.role });
    });

    return NextResponse.json({ message: 'User deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}