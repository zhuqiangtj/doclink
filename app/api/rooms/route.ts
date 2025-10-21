import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const rooms = await prisma.room.findMany();
    return NextResponse.json(rooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    return NextResponse.json({ error: 'Failed to fetch rooms' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, bedCount } = await request.json();
    if (!name || bedCount === undefined) {
      return NextResponse.json({ error: 'Missing name or bedCount' }, { status: 400 });
    }

    const newRoom = await prisma.room.create({
      data: {
        name,
        bedCount: Number(bedCount),
      },
    });
    return NextResponse.json(newRoom, { status: 201 });
  } catch (error) {
    console.error('Error creating room:', error);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}
