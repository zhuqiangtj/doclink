import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { createAuditLog } from '@/lib/audit'; // Adjust path as needed
import {
  checkResidentIdConsistency,
  getResidentIdValidationError,
} from '@/lib/china-resident-id';
import {
  getUtcDayRange,
  normalizeGovernmentId,
  normalizePatientName,
} from '@/lib/patient-scan-auth';

export async function POST(request: Request) {
  try {
    const {
      name,
      phone,
      gender,
      dateOfBirth,
      username: initialUsername,
      password,
      socialSecurityNumber,
    } = await request.json();

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

    const trimmedName = name.trim();
    const normalizedName = normalizePatientName(trimmedName);
    if (normalizedName.length < 2) {
      return NextResponse.json({ error: '姓名至少需要2个字符。' }, { status: 400 });
    }

    const normalizedSocialSecurityNumber = normalizeGovernmentId(socialSecurityNumber);
    if (!normalizedSocialSecurityNumber) {
      return NextResponse.json(
        { error: getResidentIdValidationError(socialSecurityNumber) || '新病人注册必须先扫描社保卡或身份证，识别出有效社保号后才能提交。' },
        { status: 400 }
      );
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

    const consistency = checkResidentIdConsistency({
      governmentId: normalizedSocialSecurityNumber,
      gender,
      dateOfBirth,
    });

    if (!consistency.isConsistent) {
      return NextResponse.json(
        { error: consistency.message || '社保号与出生日期或性别不一致，请核对后重试。' },
        { status: 400 }
      );
    }

    const userWithSameSocialSecurityNumber = await prisma.user.findFirst({
      where: {
        role: Role.PATIENT,
        socialSecurityNumber: normalizedSocialSecurityNumber,
      },
      select: {
        id: true,
        name: true,
        username: true,
      },
    });

    if (userWithSameSocialSecurityNumber) {
      return NextResponse.json(
        {
          error: `该社保号已关联病人 ${userWithSameSocialSecurityNumber.name}，用户名是 ${userWithSameSocialSecurityNumber.username}。`,
          existingUsername: userWithSameSocialSecurityNumber.username,
        },
        { status: 409 }
      );
    }

    const { start, end } = getUtcDayRange(dateOfBirth);
    const duplicateCandidates = await prisma.user.findMany({
      where: {
        role: Role.PATIENT,
        gender,
        dateOfBirth: {
          gte: start,
          lt: end,
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
      },
    });

    const duplicatedUser = duplicateCandidates.find(
      (user) => normalizePatientName(user.name) === normalizedName
    );

    if (duplicatedUser) {
      return NextResponse.json(
        {
          error: `该病人已存在，用户名是 ${duplicatedUser.username}，请勿重复注册。`,
          existingUsername: duplicatedUser.username,
        },
        { status: 409 }
      );
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
          username: finalUsername,
          name: trimmedName,
          phone,
          dateOfBirth: new Date(dateOfBirth),
          gender,
          socialSecurityNumber: normalizedSocialSecurityNumber,
          password: hashedPassword,
          role: Role.PATIENT,
        },
      });

      await tx.patient.create({
        data: {
          userId: newUser.id,
        },
      });
      return newUser;
    });

    await createAuditLog(null, 'REGISTER_PATIENT', 'User', user.id, { username: user.username, name: user.name, role: user.role });

    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json(userWithoutPassword, { status: 201 });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
