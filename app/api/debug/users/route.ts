import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    // 獲取所有用戶（僅用於調試）
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        doctor: {
          select: {
            id: true,
            name: true,
            specialization: true
          }
        }
      }
    });

    return NextResponse.json({ 
      success: true, 
      users,
      count: users.length 
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}