import bcrypt from 'bcrypt';
import { Prisma, Role } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { pinyin } from 'pinyin-pro';

import { authOptions } from '../../../api/auth/[...nextauth]/route';
import {
  checkResidentIdConsistency,
  getResidentIdValidationError,
} from '@/lib/china-resident-id';
import {
  DEFAULT_SCAN_PASSWORD,
  getUtcDayRange,
  normalizeGovernmentId,
  normalizePatientName,
} from '@/lib/patient-scan-auth';
import { prisma } from '@/lib/prisma';

type SupportedGender = 'Male' | 'Female' | 'Other';
type PatientSortOption =
  | 'latest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'score_desc'
  | 'score_asc'
  | 'age_desc'
  | 'age_asc';

function formatDateOnly(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

function calculateAge(birthDate: Date | null | undefined): number | null {
  if (!birthDate) return null;

  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();

  if (
    monthDelta < 0 ||
    (monthDelta === 0 && today.getDate() < birth.getDate())
  ) {
    age -= 1;
  }

  return age;
}

function formatPatientSummary(patient: {
  id: string;
  credibilityScore: number;
  user: {
    username: string;
    name: string;
    gender: string | null;
    dateOfBirth: Date | null;
    phone: string | null;
    socialSecurityNumber: string | null;
  };
  appointments: Array<{ status: string }>;
}) {
  const visitCount = patient.appointments.filter(
    (appointment) => appointment.status === 'COMPLETED'
  ).length;
  const noShowCount = patient.appointments.filter(
    (appointment) => appointment.status === 'NO_SHOW'
  ).length;

  return {
    id: patient.id,
    username: patient.user.username,
    name: patient.user.name,
    gender: patient.user.gender,
    dateOfBirth: formatDateOnly(patient.user.dateOfBirth),
    age: calculateAge(patient.user.dateOfBirth),
    phone: patient.user.phone,
    socialSecurityNumber: patient.user.socialSecurityNumber,
    credibilityScore: patient.credibilityScore,
    visitCount,
    noShowCount,
    totalAppointments: patient.appointments.length,
  };
}

function isPatientSortOption(value: string): value is PatientSortOption {
  return [
    'latest',
    'oldest',
    'name_asc',
    'name_desc',
    'score_desc',
    'score_asc',
    'age_desc',
    'age_asc',
  ].includes(value);
}

function getPatientOrderBy(sort: PatientSortOption): Prisma.PatientOrderByWithRelationInput[] {
  switch (sort) {
    case 'oldest':
      return [{ id: 'asc' }];
    case 'name_asc':
      return [{ user: { name: 'asc' } }, { id: 'desc' }];
    case 'name_desc':
      return [{ user: { name: 'desc' } }, { id: 'desc' }];
    case 'score_desc':
      return [{ credibilityScore: 'desc' }, { id: 'desc' }];
    case 'score_asc':
      return [{ credibilityScore: 'asc' }, { id: 'desc' }];
    case 'age_desc':
      return [{ user: { dateOfBirth: 'asc' } }, { id: 'desc' }];
    case 'age_asc':
      return [{ user: { dateOfBirth: 'desc' } }, { id: 'desc' }];
    case 'latest':
    default:
      return [{ id: 'desc' }];
  }
}

function isUniqueConstraintError(
  error: unknown,
  fieldName: string
): error is Prisma.PrismaClientKnownRequestError {
  const target = error instanceof Prisma.PrismaClientKnownRequestError
    ? error.meta?.target
    : null;
  const targets = Array.isArray(target)
    ? target
    : typeof target === 'string'
      ? [target]
      : [];

  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    targets.includes(fieldName)
  );
}

function buildUsernameBase(name: string): string {
  const syllables = pinyin(name, {
    toneType: 'none',
    type: 'array',
  }) as string[];

  const transliterated = syllables
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

  if (transliterated.length >= 3) {
    return transliterated;
  }

  return 'patient';
}

async function createPatientWithUniqueUsername(params: {
  name: string;
  phone: string;
  gender: SupportedGender;
  dateOfBirth: string;
  socialSecurityNumber: string;
  hashedPassword: string;
}) {
  const baseUsername = buildUsernameBase(params.name);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidateUsername =
      attempt === 0 ? baseUsername : `${baseUsername}${attempt}`;

    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: candidateUsername,
            name: params.name,
            phone: params.phone,
            gender: params.gender,
            dateOfBirth: new Date(params.dateOfBirth),
            socialSecurityNumber: params.socialSecurityNumber,
            password: params.hashedPassword,
            role: Role.PATIENT,
          },
        });

        return tx.patient.create({
          data: {
            userId: user.id,
          },
          include: {
            user: {
              select: {
                username: true,
                name: true,
                gender: true,
                dateOfBirth: true,
                phone: true,
                socialSecurityNumber: true,
              },
            },
            appointments: {
              select: {
                status: true,
              },
            },
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error, 'username')) {
        continue;
      }

      throw error;
    }
  }

  throw new Error('系统暂时无法生成可用用户名，请稍后再试。');
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.max(1, parseInt(searchParams.get('limit') || '50', 10));
  const search = searchParams.get('search') || '';
  const sortParam = searchParams.get('sort') || 'name_asc';
  const sort = isPatientSortOption(sortParam) ? sortParam : 'name_asc';
  const skip = (page - 1) * limit;

  try {
    const where: Prisma.PatientWhereInput = {};

    if (search) {
      where.user = {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      };
    }

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        skip,
        take: limit,
        orderBy: getPatientOrderBy(sort),
        include: {
          user: {
            select: {
              username: true,
              name: true,
              gender: true,
              dateOfBirth: true,
              phone: true,
              socialSecurityNumber: true,
            },
          },
          appointments: {
            select: {
              status: true,
            },
          },
        },
      }),
      prisma.patient.count({ where }),
    ]);

    return NextResponse.json({
      patients: patients.map(formatPatientSummary),
      total,
      page,
      sort,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error fetching patients:', error);
    return NextResponse.json(
      { error: 'Failed to fetch patients' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const gender = typeof body.gender === 'string' ? body.gender : '';
    const dateOfBirth =
      typeof body.dateOfBirth === 'string' ? body.dateOfBirth : '';
    const normalizedName = normalizePatientName(name);
    const normalizedSocialSecurityNumber = normalizeGovernmentId(
      body.socialSecurityNumber || null
    );

    if (normalizedName.length < 2) {
      return NextResponse.json(
        { error: '姓名至少需要 2 个字。' },
        { status: 400 }
      );
    }

    if (!['Male', 'Female', 'Other'].includes(gender)) {
      return NextResponse.json(
        { error: '请选择有效的性别。' },
        { status: 400 }
      );
    }

    if (!dateOfBirth) {
      return NextResponse.json(
        { error: '出生日期不能为空。' },
        { status: 400 }
      );
    }

    const birthDate = new Date(dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) {
      return NextResponse.json(
        { error: '出生日期格式无效。' },
        { status: 400 }
      );
    }

    const today = new Date();
    if (birthDate > today) {
      return NextResponse.json(
        { error: '出生日期不能晚于今天。' },
        { status: 400 }
      );
    }

    const age = calculateAge(birthDate);
    if (age === null || age > 150) {
      return NextResponse.json(
        { error: '请输入有效的出生日期。' },
        { status: 400 }
      );
    }

    if (!/^[1-9]\d{10}$/.test(phone)) {
      return NextResponse.json(
        { error: '请输入有效的 11 位手机号码。' },
        { status: 400 }
      );
    }

    if (!normalizedSocialSecurityNumber) {
      return NextResponse.json(
        {
          error:
            getResidentIdValidationError(body.socialSecurityNumber || null) ||
            '新建病人时必须填写有效的社保号或身份证号。',
        },
        { status: 400 }
      );
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

    const existingBySocialSecurityNumber = await prisma.user.findFirst({
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

    if (existingBySocialSecurityNumber) {
      return NextResponse.json(
        {
          error: `该社保号已关联病人 ${existingBySocialSecurityNumber.name}，用户名是 ${existingBySocialSecurityNumber.username}。`,
          existingUsername: existingBySocialSecurityNumber.username,
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

    const hashedPassword = await bcrypt.hash(DEFAULT_SCAN_PASSWORD, 10);

    let createdPatient;
    try {
      createdPatient = await createPatientWithUniqueUsername({
        name,
        phone,
        gender: gender as SupportedGender,
        dateOfBirth,
        socialSecurityNumber: normalizedSocialSecurityNumber,
        hashedPassword,
      });
    } catch (error) {
      if (isUniqueConstraintError(error, 'socialSecurityNumber')) {
        const conflictedUser = await prisma.user.findFirst({
          where: {
            role: Role.PATIENT,
            socialSecurityNumber: normalizedSocialSecurityNumber,
          },
          select: {
            name: true,
            username: true,
          },
        });

        return NextResponse.json(
          {
            error: conflictedUser
              ? `该社保号已关联病人 ${conflictedUser.name}，用户名是 ${conflictedUser.username}。`
              : '该社保号已被其他病人使用。',
            existingUsername: conflictedUser?.username,
          },
          { status: 409 }
        );
      }

      throw error;
    }

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        userName: session.user.name,
        userUsername: session.user.username,
        userRole: session.user.role,
        action: 'DOCTOR_CREATE_PATIENT',
        entityType: 'Patient',
        entityId: createdPatient.id,
        details: JSON.stringify({
          createdPatientId: createdPatient.id,
          username: createdPatient.user.username,
          name: createdPatient.user.name,
          socialSecurityNumber: createdPatient.user.socialSecurityNumber,
          defaultPassword: DEFAULT_SCAN_PASSWORD,
        }),
      },
    });

    return NextResponse.json(
      {
        patient: formatPatientSummary(createdPatient),
        defaultPassword: DEFAULT_SCAN_PASSWORD,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating patient for doctor:', error);
    return NextResponse.json(
      { error: '创建病人失败，请稍后重试。' },
      { status: 500 }
    );
  }
}
