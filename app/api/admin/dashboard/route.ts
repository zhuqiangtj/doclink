import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// Admin dashboard API endpoint

export async function GET() {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

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
