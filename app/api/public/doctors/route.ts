import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 公共医生列表：返回 doctor.id 与对应 user.name，供病人端使用
export async function GET() {
  try {
    const doctors = await prisma.doctor.findMany({
      include: {
        user: { select: { name: true } }
      },
      orderBy: { 
        user: { name: 'asc' }
      }
    });

const result = doctors.map(d => ({ id: d.id, name: d.user?.name || '未知医生' }));
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching public doctors:', error);
    return NextResponse.json({ error: 'Failed to fetch doctors' }, { status: 500 });
  }
}