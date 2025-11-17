import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';

export async function POST(request: NextRequest) {
  try {
// 检查用户是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { username: 'zhangru' }
    });

    if (existingUser) {
      const hashedPassword = await bcrypt.hash('123456', 10);
      const updated = await prisma.user.update({
        where: { id: existingUser.id },
        data: { password: hashedPassword, role: 'DOCTOR', name: existingUser.name || '张如医生' }
      });
      const doctor = await prisma.doctor.findUnique({ where: { userId: updated.id } })
        ?? await prisma.doctor.create({ data: { userId: updated.id } });
      return NextResponse.json({ 
        success: true, 
        message: '用戶 zhangru 已存在，已重置密碼',
        user: {
          id: updated.id,
          username: updated.username,
          name: updated.name,
          role: updated.role
        },
        doctor: { id: doctor.id }
      });
    }

// 创建新用户
    const hashedPassword = await bcrypt.hash('123456', 10);
    
    const newUser = await prisma.user.create({
      data: {
        username: 'zhangru',
        password: hashedPassword,
  name: '张如医生',
        gender: 'Female',
        dateOfBirth: new Date('1975-06-10T00:00:00.000Z'),
        role: 'DOCTOR'
      }
    });

// 创建医生资料
    const doctor = await prisma.doctor.create({
      data: {
        userId: newUser.id,
      }
    });

    return NextResponse.json({ 
      success: true, 
  message: '用户 zhangru 创建成功',
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
  console.error('创建用户错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}