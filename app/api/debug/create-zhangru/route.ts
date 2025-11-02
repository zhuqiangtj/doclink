import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';

export async function POST(request: NextRequest) {
  try {
    // 檢查用戶是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { username: 'zhangru' }
    });

    if (existingUser) {
      return NextResponse.json({ 
        success: true, 
        message: '用戶 zhangru 已存在',
        user: {
          id: existingUser.id,
          username: existingUser.username,
          name: existingUser.name,
          role: existingUser.role
        }
      });
    }

    // 創建新用戶
    const hashedPassword = await bcrypt.hash('123456', 10);
    
    const newUser = await prisma.user.create({
      data: {
        username: 'zhangru',
        password: hashedPassword,
        name: '張如醫生',
        gender: 'Female',
        dateOfBirth: new Date('1975-06-10T00:00:00.000Z'),
        role: 'DOCTOR'
      }
    });

    // 創建醫生資料
    const doctor = await prisma.doctor.create({
      data: {
        userId: newUser.id,
      }
    });

    return NextResponse.json({ 
      success: true, 
      message: '用戶 zhangru 創建成功',
      user: {
        id: newUser.id,
        username: newUser.username,
        name: newUser.name,
        role: newUser.role
      },
      doctor: {
        id: doctor.id
      }
    });

  } catch (error) {
    console.error('創建用戶錯誤:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}