import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const totalUsers = await prisma.user.count();
    const totalDoctors = await prisma.user.count({ where: { role: 'DOCTOR' } });
    const totalPatients = await prisma.user.count({ where: { role: 'PATIENT' } });

    // You can add more stats here as needed, e.g., today's appointments

    return NextResponse.json({
      totalUsers,
      totalDoctors,
      totalPatients,
    });

  } catch (error) {
    console.error('Admin dashboard stats error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
