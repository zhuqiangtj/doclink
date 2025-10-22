import { PrismaClient, Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// GET all doctors
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const doctors = await prisma.doctor.findMany({
      include: {
        user: {
          select: { email: true },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
    return NextResponse.json(doctors);
  } catch (err) {
    console.error('Error fetching doctors:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST (create) a new doctor
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { name, email, password } = await request.json();
    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Use a transaction to create both User and Doctor records
    const newDoctor = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: Role.DOCTOR,
        },
      });

      const doctor = await tx.doctor.create({
        data: {
          name,
          userId: user.id,
        },
        include: {
          user: { select: { email: true } },
        },
      });
      return doctor;
    });

    return NextResponse.json(newDoctor, { status: 201 });
  } catch (err) {
    console.error('Error creating doctor:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) a doctor's info or reset password
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get('doctorId');
  if (!doctorId) {
    return NextResponse.json({ error: 'Doctor ID is required' }, { status: 400 });
  }

  try {
    const { name, password } = await request.json();

    if (name) {
      // Update doctor's name
      const updatedDoctor = await prisma.doctor.update({
        where: { id: doctorId },
        data: { name },
        include: { user: { select: { email: true } } },
      });
      return NextResponse.json(updatedDoctor);
    }

    if (password) {
      // Reset user's password
      const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
      if (!doctor) return NextResponse.json({ error: 'Doctor not found' }, { status: 404 });

      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: doctor.userId },
        data: { password: hashedPassword },
      });
      return NextResponse.json({ message: 'Password reset successfully' });
    }

    return NextResponse.json({ error: 'No update data provided' }, { status: 400 });

  } catch (err) {
    console.error('Error updating doctor:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE a doctor
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get('doctorId');
  if (!doctorId) {
    return NextResponse.json({ error: 'Doctor ID is required' }, { status: 400 });
  }

  try {
    // Use a transaction to delete the Doctor and associated User records
    await prisma.$transaction(async (tx) => {
      const doctor = await tx.doctor.findUnique({ where: { id: doctorId } });
      if (!doctor) throw new Error('Doctor not found.');

      // Note: Add logic here to handle/reassign appointments or schedules if needed
      
      await tx.doctor.delete({ where: { id: doctorId } });
      await tx.user.delete({ where: { id: doctor.userId } });
    });

    return NextResponse.json({ message: 'Doctor deleted successfully' }, { status: 200 });
  } catch (err) {
    console.error('Error deleting doctor:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
