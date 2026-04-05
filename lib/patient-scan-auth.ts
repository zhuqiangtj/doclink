import { Prisma, Role, User } from '@prisma/client';
import bcrypt from 'bcrypt';
import pinyin from 'pinyin';

import { createAuditLog } from '@/lib/audit';
import {
  checkResidentIdConsistency,
  validateChineseResidentId,
} from '@/lib/china-resident-id';
import { prisma } from '@/lib/prisma';

export const DEFAULT_SCAN_PASSWORD = '123456';

type SupportedGender = 'Male' | 'Female' | 'Other';

export interface PatientScanInput {
  socialSecurityNumber?: string | null;
  name?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
}

export interface PatientScanResult {
  user: User;
  created: boolean;
  linked: boolean;
}

export function normalizePatientName(name: string): string {
  return name.trim().replace(/\s+/g, '');
}

export function normalizeGovernmentId(value: string | null | undefined): string | null {
  const validation = validateChineseResidentId(value);
  return validation.isValid ? validation.normalized : null;
}

export function getUtcDayRange(dateString: string) {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function isSupportedGender(value: string | null | undefined): value is SupportedGender {
  return value === 'Male' || value === 'Female' || value === 'Other';
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
  const transliterated = pinyin(name, { style: pinyin.STYLE_NORMAL })
    .flat()
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

  if (transliterated.length >= 3) {
    return transliterated;
  }

  return 'patient';
}

async function findAvailableUsername(baseUsername: string): Promise<string> {
  let candidate = baseUsername;
  let counter = 1;

  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    candidate = `${baseUsername}${counter}`;
    counter += 1;
  }

  return candidate;
}

async function createPatientFromScan(params: {
  socialSecurityNumber: string;
  name: string;
  gender: SupportedGender;
  dateOfBirth: string;
}): Promise<User> {
  const hashedPassword = await bcrypt.hash(DEFAULT_SCAN_PASSWORD, 10);
  const trimmedName = params.name.trim();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const uniqueBase =
      attempt === 0
        ? buildUsernameBase(trimmedName)
        : `${buildUsernameBase(trimmedName)}${Date.now().toString().slice(-4)}${attempt}`;
    const finalUsername = await findAvailableUsername(uniqueBase);

    try {
      const user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            username: finalUsername,
            name: trimmedName,
            gender: params.gender,
            dateOfBirth: new Date(params.dateOfBirth),
            socialSecurityNumber: params.socialSecurityNumber,
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

      await createAuditLog(null, 'AUTO_REGISTER_PATIENT_BY_SCAN', 'User', user.id, {
        username: user.username,
        name: user.name,
        socialSecurityNumber: user.socialSecurityNumber,
      });

      return user;
    } catch (error) {
      if (isUniqueConstraintError(error, 'username')) {
        continue;
      }

      if (isUniqueConstraintError(error, 'socialSecurityNumber')) {
        const existingUser = await prisma.user.findFirst({
          where: {
            role: Role.PATIENT,
            socialSecurityNumber: params.socialSecurityNumber,
          },
        });

        if (existingUser) {
          return existingUser;
        }
      }

      throw error;
    }
  }

  throw new Error('自动创建账户失败，请稍后重试。');
}

async function findPatientByDemographics(params: {
  name: string;
  gender: SupportedGender;
  dateOfBirth: string;
}): Promise<User | null> {
  const { start, end } = getUtcDayRange(params.dateOfBirth);
  const normalizedName = normalizePatientName(params.name);

  const candidates = await prisma.user.findMany({
    where: {
      role: Role.PATIENT,
      gender: params.gender,
      dateOfBirth: {
        gte: start,
        lt: end,
      },
    },
  });

  return (
    candidates.find((candidate) => normalizePatientName(candidate.name) === normalizedName) ||
    null
  );
}

function isSameUtcDay(date: Date | null, dateString: string | null | undefined): boolean {
  if (!date || !dateString) return true;

  const { start, end } = getUtcDayRange(dateString);
  return date >= start && date < end;
}

function getValidatedSocialSecurityNumber(input: PatientScanInput): string {
  const residentIdValidation = validateChineseResidentId(input.socialSecurityNumber);
  if (!residentIdValidation.isValid || !residentIdValidation.normalized) {
    throw new Error(residentIdValidation.error || '未识别到有效的社保号，请重新扫描。');
  }

  const consistency = checkResidentIdConsistency({
    governmentId: residentIdValidation.normalized,
    gender: input.gender,
    dateOfBirth: input.dateOfBirth,
  });
  if (!consistency.isConsistent) {
    throw new Error(
      consistency.message || '识别到的社保号与出生日期或性别不一致，请重新扫描或人工核对。'
    );
  }

  return residentIdValidation.normalized;
}

function assertScannedIdentityMatchesUser(user: User, input: PatientScanInput) {
  if (
    input.name &&
    normalizePatientName(input.name) !== normalizePatientName(user.name)
  ) {
    throw new Error('识别到的姓名与系统档案不一致，请重新扫描或人工核对。');
  }

  if (
    isSupportedGender(input.gender) &&
    user.gender &&
    user.gender !== input.gender
  ) {
    throw new Error('识别到的性别与系统档案不一致，请重新扫描或人工核对。');
  }

  if (
    input.dateOfBirth &&
    user.dateOfBirth &&
    !isSameUtcDay(user.dateOfBirth, input.dateOfBirth)
  ) {
    throw new Error('识别到的出生日期与系统档案不一致，请重新扫描或人工核对。');
  }
}

export async function resolveExistingPatientFromScan(
  input: PatientScanInput
): Promise<User> {
  const socialSecurityNumber = getValidatedSocialSecurityNumber(input);

  const existingPatient = await prisma.user.findFirst({
    where: {
      role: Role.PATIENT,
      socialSecurityNumber,
    },
  });

  if (!existingPatient) {
    throw new Error('未找到已绑定该社保号的病人账户，请先联系医护人员建档或补录社保号。');
  }

  assertScannedIdentityMatchesUser(existingPatient, input);
  return existingPatient;
}

export async function resolvePatientFromScan(
  input: PatientScanInput
): Promise<PatientScanResult> {
  const socialSecurityNumber = getValidatedSocialSecurityNumber(input);

  const existingBySocialSecurity = await prisma.user.findFirst({
    where: {
      role: Role.PATIENT,
      socialSecurityNumber,
    },
  });

  if (existingBySocialSecurity) {
    assertScannedIdentityMatchesUser(existingBySocialSecurity, input);

    return {
      user: existingBySocialSecurity,
      created: false,
      linked: false,
    };
  }

  if (
    input.name &&
    input.dateOfBirth &&
    isSupportedGender(input.gender)
  ) {
    const matchedPatient = await findPatientByDemographics({
      name: input.name,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
    });

    if (matchedPatient) {
      if (
        matchedPatient.socialSecurityNumber &&
        matchedPatient.socialSecurityNumber !== socialSecurityNumber
      ) {
        throw new Error('该病人已绑定其他社保号，请联系管理员核对。');
      }

      const linkedUser = await prisma.user.update({
        where: { id: matchedPatient.id },
        data: { socialSecurityNumber },
      });

      await createAuditLog(
        null,
        'LINK_PATIENT_SOCIAL_SECURITY_NUMBER',
        'User',
        linkedUser.id,
        {
          username: linkedUser.username,
          name: linkedUser.name,
          socialSecurityNumber,
        }
      );

      return {
        user: linkedUser,
        created: false,
        linked: true,
      };
    }
  }

  if (!input.name || !input.name.trim()) {
    throw new Error('未识别到姓名，暂时无法自动建档，请核对后再试。');
  }

  if (!isSupportedGender(input.gender)) {
    throw new Error('未识别到有效性别，暂时无法自动建档，请核对后再试。');
  }

  if (!input.dateOfBirth) {
    throw new Error('未识别到出生日期，暂时无法自动建档，请核对后再试。');
  }

  const birthDate = new Date(input.dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) {
    throw new Error('出生日期格式无效，暂时无法自动建档。');
  }

  const user = await createPatientFromScan({
    socialSecurityNumber,
    name: input.name,
    gender: input.gender,
    dateOfBirth: input.dateOfBirth,
  });

  return {
    user,
    created: true,
    linked: false,
  };
}
