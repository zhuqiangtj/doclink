import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { createAuditLog } from '@/lib/audit'; // Adjust path as needed


export async function POST(request: Request) {
  try {
    const { name, phone, gender, dateOfBirth, username: initialUsername, password } = await request.json();

    if (!name || !initialUsername || !gender || !dateOfBirth || !password || !phone) {
      return NextResponse.json({ error: '缺少必填字段：姓名、用户名、性别、出生日期、联系电话、密码。' }, { status: 400 });
    }

    if (initialUsername.length < 3) {
      return NextResponse.json({ error: '用户名至少需要3个字符。' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少需要6个字符。' }, { status: 400 });
    }

    if (name.trim().length < 2) {
      return NextResponse.json({ error: '姓名至少需要2个字符。' }, { status: 400 });
    }

    if (!['Male', 'Female', 'Other'].includes(gender)) {
      return NextResponse.json({ error: '性别格式无效。' }, { status: 400 });
    }

    if (!/^[1-9]\d{10}$/.test(phone)) {
      return NextResponse.json({ error: '请输入有效的11位手机号码。' }, { status: 400 });
    }

    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      return NextResponse.json({ error: '出生日期格式无效。' }, { status: 400 });
    }
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    if (age < 0 || age > 150) {
      return NextResponse.json({ error: '请输入有效的出生日期。' }, { status: 400 });
    }

    let finalUsername = initialUsername;
    let counter = 1;
    while (await prisma.user.findUnique({ where: { username: finalUsername } })) {
      finalUsername = `${initialUsername}${counter}`;
      counter++;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: finalUsername, // Use the guaranteed unique username
          name,
          phone,
          dateOfBirth: new Date(dateOfBirth),
          gender,
          password: hashedPassword,
          role: Role.PATIENT, // Always register as a PATIENT
        },
      });

      await tx.patient.create({
        data: {
          userId: newUser.id,
        },
      });
      return newUser;
    });

    // Log the registration action
    await createAuditLog(null, 'REGISTER_PATIENT', 'User', user.id, { username: user.username, name: user.name, role: user.role });

    // Don't return the password hash in the response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json(userWithoutPassword, { status: 201 });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}