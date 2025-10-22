import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '../../../lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

// GET rooms (Admin gets all, Doctor gets their own)
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let rooms;
    if (session.user.role === 'ADMIN') {
      rooms = await prisma.room.findMany({
        orderBy: { name: 'asc' },
      });
    } else if (session.user.role === 'DOCTOR') {
      const doctorProfile = await prisma.doctor.findUnique({
        where: { userId: session.user.id },
        include: { rooms: true },
      });
      rooms = doctorProfile?.rooms || [];
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(rooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST a new room (Doctor only)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { name, bedCount } = await request.json();

    if (!name || bedCount === undefined || bedCount < 1) {
      return NextResponse.json({ error: 'Missing required fields or invalid bedCount' }, { status: 400 });
    }

    const doctorProfile = await prisma.doctor.findUnique({
      where: { userId: session.user.id },
    });

    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const newRoom = await prisma.room.create({
      data: {
        name,
        bedCount: Number(bedCount),
        doctors: {
          connect: { id: doctorProfile.id },
        },
      },
    });

    await createAuditLog(session, 'CREATE_ROOM', 'Room', newRoom.id, { name, bedCount, doctorId: doctorProfile.id });
    return NextResponse.json(newRoom, { status: 201 });

  } catch (error) {
    console.error('Error creating room:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) a room (Admin or Doctor for their own rooms)
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');
  if (!roomId) {
    return NextResponse.json({ error: 'Room ID is required' }, { status: 400 });
  }

  try {
    const { name, bedCount } = await request.json();
    if (!name && bedCount === undefined) {
      return NextResponse.json({ error: 'No update data provided' }, { status: 400 });
    }

    const existingRoom = await prisma.room.findUnique({ where: { id: roomId }, include: { doctors: true } });
    if (!existingRoom) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    // Authorization
    if (session.user.role === 'DOCTOR') {
      const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
      if (!doctorProfile || !existingRoom.doctors.some(d => d.id === doctorProfile.id)) {
        return NextResponse.json({ error: 'Forbidden: You can only update your own rooms.' }, { status: 403 });
      }
    } else if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updatedRoom = await prisma.room.update({
      where: { id: roomId },
      data: {
        name: name || existingRoom.name,
        bedCount: bedCount !== undefined ? Number(bedCount) : existingRoom.bedCount,
      },
    });

    await createAuditLog(session, 'UPDATE_ROOM', 'Room', updatedRoom.id, { old: existingRoom, new: updatedRoom });
    return NextResponse.json(updatedRoom);

  } catch (error) {
    console.error(`Error updating room ${roomId}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE a room (Admin or Doctor for their own rooms)
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  if (!roomId) {
    return NextResponse.json({ error: 'Room ID is required' }, { status: 400 });
  }

  try {
    const existingRoom = await prisma.room.findUnique({ where: { id: roomId }, include: { doctors: true } });
    if (!existingRoom) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    // Authorization
    if (session.user.role === 'DOCTOR') {
      const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
      if (!doctorProfile || !existingRoom.doctors.some(d => d.id === doctorProfile.id)) {
        return NextResponse.json({ error: 'Forbidden: You can only delete your own rooms.' }, { status: 403 });
      }
    } else if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Note: Add logic here to handle existing schedules or appointments in this room if necessary
    // For now, we will just delete it.

    await prisma.room.delete({
      where: { id: roomId },
    });

    await createAuditLog(session, 'DELETE_ROOM', 'Room', roomId, { name: existingRoom.name });
    return NextResponse.json({ message: 'Room deleted successfully' }, { status: 200 });

  } catch (error) {
    console.error(`Error deleting room ${roomId}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

