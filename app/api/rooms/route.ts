import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

// GET rooms (Admin gets all, Doctor gets their own)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let rooms;
    if (session.user.role === 'ADMIN') {
      rooms = await prisma.room.findMany({
        include: { doctor: { include: { user: { select: { id: true, name: true } } } } }, // Corrected include
        orderBy: { name: 'asc' },
      });
    } else if (session.user.role === 'DOCTOR') {
      const doctorProfile = await prisma.doctor.findUnique({
        where: { userId: session.user.id },
      });
      if (!doctorProfile) return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });

      rooms = await prisma.room.findMany({
        where: { doctorId: doctorProfile.id },
        include: { doctor: { include: { user: { select: { id: true, name: true } } } } }, // Corrected include
        orderBy: { name: 'asc' },
      });
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(rooms);
  } catch (err) {
    console.error('Error fetching rooms:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST a new room (Doctor creates for self, Admin creates for specified doctor)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { name, bedCount, doctorId: requestDoctorId } = await request.json();

    if (!name || !bedCount || bedCount < 1) {
      return NextResponse.json({ error: 'Missing required fields or invalid bedCount' }, { status: 400 });
    }

    let targetDoctorId: string;

    if (session.user.role === 'DOCTOR') {
      const doctorProfile = await prisma.doctor.findUnique({
        where: { userId: session.user.id },
      });
      if (!doctorProfile) return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
      targetDoctorId = doctorProfile.id;
      // If doctor tries to specify a different doctorId, forbid it
      if (requestDoctorId && requestDoctorId !== targetDoctorId) {
        return NextResponse.json({ error: 'Forbidden: Doctors can only create rooms for themselves.' }, { status: 403 });
      }
    } else if (session.user.role === 'ADMIN') {
      if (!requestDoctorId) {
        return NextResponse.json({ error: 'Admin must specify doctorId for the room.' }, { status: 400 });
      }
      const doctorExists = await prisma.doctor.findUnique({ where: { id: requestDoctorId } });
      if (!doctorExists) {
        return NextResponse.json({ error: 'Specified doctor not found.' }, { status: 404 });
      }
      targetDoctorId = requestDoctorId;
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const newRoom = await prisma.room.create({
      data: {
        name,
        bedCount: Number(bedCount),
        doctorId: targetDoctorId,
      },
      include: { doctor: { include: { user: { select: { id: true, name: true } } } } }, // Corrected include
    });

    await createAuditLog(session, 'CREATE_ROOM', 'Room', newRoom.id, { name, bedCount, doctorId: targetDoctorId });
    return NextResponse.json(newRoom, { status: 201 });

  } catch (err) {
    console.error('Error creating room:', err);
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
    const { name, bedCount, doctorId: newDoctorId } = await request.json();
    if (!name && bedCount === undefined && newDoctorId === undefined) {
      return NextResponse.json({ error: 'No update data provided' }, { status: 400 });
    }

    const existingRoom = await prisma.room.findUnique({ where: { id: roomId } });
    if (!existingRoom) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    // Authorization and data preparation
    const updateData: { name?: string; bedCount?: number; doctorId?: string } = {};

    if (session.user.role === 'DOCTOR') {
      const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
      if (!doctorProfile || existingRoom.doctorId !== doctorProfile.id) {
        return NextResponse.json({ error: 'Forbidden: You can only update your own rooms.' }, { status: 403 });
      }
      // Doctors can only update name and bedCount, not change owner
      if (name) updateData.name = name;
      if (bedCount !== undefined) updateData.bedCount = Number(bedCount);
      if (newDoctorId !== undefined && newDoctorId !== existingRoom.doctorId) {
        return NextResponse.json({ error: 'Forbidden: Doctors cannot change room ownership.' }, { status: 403 });
      }
    } else if (session.user.role === 'ADMIN') {
      if (name) updateData.name = name;
      if (bedCount !== undefined) updateData.bedCount = Number(bedCount);
      if (newDoctorId !== undefined) {
        const doctorExists = await prisma.doctor.findUnique({ where: { id: newDoctorId } });
        if (!doctorExists) {
          return NextResponse.json({ error: 'Specified new doctor owner not found.' }, { status: 404 });
        }
        updateData.doctorId = newDoctorId;
      }
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updatedRoom = await prisma.room.update({
      where: { id: roomId },
      data: updateData,
      include: { doctor: { include: { user: { select: { id: true, name: true } } } } }, // Corrected include
    });

    await createAuditLog(session, 'UPDATE_ROOM', 'Room', updatedRoom.id, { old: existingRoom, new: updatedRoom });
    return NextResponse.json(updatedRoom);

  } catch (err) {
    console.error(`Error updating room ${roomId}:`, err);
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
    const existingRoom = await prisma.room.findUnique({ where: { id: roomId } });
    if (!existingRoom) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    // Authorization
    if (session.user.role === 'DOCTOR') {
      const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
      if (!doctorProfile || existingRoom.doctorId !== doctorProfile.id) {
        return NextResponse.json({ error: 'Forbidden: You can only delete your own rooms.' }, { status: 403 });
      }
    } else if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Before deleting the room, delete all associated schedules and appointments
    await prisma.appointment.deleteMany({ where: { roomId: roomId } });
    await prisma.schedule.deleteMany({ where: { roomId: roomId } });

    await prisma.room.delete({
      where: { id: roomId },
    });

    await createAuditLog(session, 'DELETE_ROOM', 'Room', roomId, { name: existingRoom.name });
    return NextResponse.json({ message: 'Room deleted successfully' }, { status: 200 });

  } catch (err) {
    console.error(`Error deleting room ${roomId}:`, err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
