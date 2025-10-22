import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient();

// GET all audit logs (Admin only)
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: {
        timestamp: 'desc',
      },
      take: 100, // Limit to last 100 logs for performance
    });

    // Parse JSON details for frontend consumption
    const formattedLogs = logs.map(log => ({
      ...log,
      details: log.details ? JSON.parse(log.details as string) : null,
    }));

    return NextResponse.json(formattedLogs);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
