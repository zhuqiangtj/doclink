export type ResidentIdGender = 'Male' | 'Female';

export type ResidentIdValidationIssue =
  | 'empty'
  | 'format'
  | 'birthDate'
  | 'checksum';

export interface ResidentIdValidationResult {
  input: string | null;
  normalized: string | null;
  isValid: boolean;
  issue: ResidentIdValidationIssue | null;
  error: string | null;
  derivedDateOfBirth: string | null;
  derivedGender: ResidentIdGender | null;
  checksumExpected: string | null;
  checksumActual: string | null;
}

export interface ResidentIdConsistencyResult {
  normalizedGovernmentId: string | null;
  derivedDateOfBirth: string | null;
  derivedGender: ResidentIdGender | null;
  isValidGovernmentId: boolean;
  isConsistent: boolean;
  dateOfBirthMatches: boolean | null;
  genderMatches: boolean | null;
  message: string | null;
}

const RESIDENT_ID_WEIGHTS = [
  7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2,
] as const;

const RESIDENT_ID_CHECKSUM_MAP = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

function normalizeResidentIdInput(value: string | null | undefined): string | null {
  if (!value) return null;

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^0-9X]/g, '');

  return normalized || null;
}

export function normalizeChineseResidentId(value: string | null | undefined): string | null {
  const validation = validateChineseResidentId(value);
  return validation.isValid ? validation.normalized : null;
}

export function isValidDateOnly(value: string | null | undefined): value is string {
  if (!value) return false;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const now = new Date();

  if (year < 1900 || year > now.getFullYear()) {
    return false;
  }

  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function normalizeDateOnlyInput(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  const dashedMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  let candidate: string | null = null;
  if (compactMatch) {
    candidate = `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  } else if (dashedMatch) {
    candidate = `${dashedMatch[1]}-${dashedMatch[2].padStart(2, '0')}-${dashedMatch[3].padStart(2, '0')}`;
  }

  return candidate && isValidDateOnly(candidate) ? candidate : null;
}

function normalizeGenderInput(value: string | null | undefined): ResidentIdGender | null {
  if (!value) return null;

  const normalized = value.trim().toUpperCase();
  if (normalized === 'MALE' || normalized === 'M' || normalized === '男' || normalized === '男性') {
    return 'Male';
  }
  if (normalized === 'FEMALE' || normalized === 'F' || normalized === '女' || normalized === '女性') {
    return 'Female';
  }

  return null;
}

function computeResidentIdChecksum(prefix17: string): string {
  let total = 0;

  for (let index = 0; index < prefix17.length; index += 1) {
    total += Number(prefix17[index]) * RESIDENT_ID_WEIGHTS[index];
  }

  return RESIDENT_ID_CHECKSUM_MAP[total % 11];
}

export function validateChineseResidentId(
  value: string | null | undefined
): ResidentIdValidationResult {
  const normalized = normalizeResidentIdInput(value);

  if (!normalized) {
    return {
      input: value ?? null,
      normalized: null,
      isValid: false,
      issue: 'empty',
      error: '未填写社保号或身份证号。',
      derivedDateOfBirth: null,
      derivedGender: null,
      checksumExpected: null,
      checksumActual: null,
    };
  }

  if (!/^\d{17}[\dX]$/.test(normalized)) {
    return {
      input: value ?? null,
      normalized,
      isValid: false,
      issue: 'format',
      error: '社保号或身份证号应为 18 位，前 17 位为数字，最后 1 位为数字或大写 X。',
      derivedDateOfBirth: null,
      derivedGender: null,
      checksumExpected: null,
      checksumActual: normalized.slice(-1),
    };
  }

  const derivedDateOfBirth = normalizeDateOnlyInput(
    `${normalized.slice(6, 10)}-${normalized.slice(10, 12)}-${normalized.slice(12, 14)}`
  );
  if (!derivedDateOfBirth) {
    return {
      input: value ?? null,
      normalized,
      isValid: false,
      issue: 'birthDate',
      error: '社保号或身份证号中的出生日期无效，请核对后重试。',
      derivedDateOfBirth: null,
      derivedGender: null,
      checksumExpected: null,
      checksumActual: normalized.slice(-1),
    };
  }

  const expectedChecksum = computeResidentIdChecksum(normalized.slice(0, 17));
  const actualChecksum = normalized.slice(-1);
  if (expectedChecksum !== actualChecksum) {
    return {
      input: value ?? null,
      normalized,
      isValid: false,
      issue: 'checksum',
      error: '社保号或身份证号校验位不正确，可能是扫描识别有误，请重新核对。',
      derivedDateOfBirth,
      derivedGender: Number(normalized[16]) % 2 === 0 ? 'Female' : 'Male',
      checksumExpected: expectedChecksum,
      checksumActual: actualChecksum,
    };
  }

  return {
    input: value ?? null,
    normalized,
    isValid: true,
    issue: null,
    error: null,
    derivedDateOfBirth,
    derivedGender: Number(normalized[16]) % 2 === 0 ? 'Female' : 'Male',
    checksumExpected: expectedChecksum,
    checksumActual: actualChecksum,
  };
}

export function getResidentIdValidationError(
  value: string | null | undefined
): string | null {
  const result = validateChineseResidentId(value);
  return result.isValid ? null : result.error;
}

export function checkResidentIdConsistency(params: {
  governmentId: string | null | undefined;
  dateOfBirth?: string | null;
  gender?: string | null;
}): ResidentIdConsistencyResult {
  const validation = validateChineseResidentId(params.governmentId);

  if (!validation.isValid) {
    return {
      normalizedGovernmentId: validation.normalized,
      derivedDateOfBirth: validation.derivedDateOfBirth,
      derivedGender: validation.derivedGender,
      isValidGovernmentId: false,
      isConsistent: false,
      dateOfBirthMatches: null,
      genderMatches: null,
      message: validation.error,
    };
  }

  const normalizedDateOfBirth = normalizeDateOnlyInput(params.dateOfBirth);
  const normalizedGender = normalizeGenderInput(params.gender);
  const dateOfBirthMatches = normalizedDateOfBirth
    ? normalizedDateOfBirth === validation.derivedDateOfBirth
    : null;
  const genderMatches = normalizedGender
    ? normalizedGender === validation.derivedGender
    : null;

  let message: string | null = null;
  if (dateOfBirthMatches === false && genderMatches === false) {
    message = '社保号或身份证号与当前填写的出生日期、性别不一致，可能是扫描识别有误，请重新核对。';
  } else if (dateOfBirthMatches === false) {
    message = '社保号或身份证号与当前填写的出生日期不一致，可能是扫描识别有误，请重新核对。';
  } else if (genderMatches === false) {
    message = '社保号或身份证号与当前填写的性别不一致，可能是扫描识别有误，请重新核对。';
  }

  return {
    normalizedGovernmentId: validation.normalized,
    derivedDateOfBirth: validation.derivedDateOfBirth,
    derivedGender: validation.derivedGender,
    isValidGovernmentId: true,
    isConsistent: !message,
    dateOfBirthMatches,
    genderMatches,
    message,
  };
}
