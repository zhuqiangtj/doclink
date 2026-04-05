import { normalizeDateOnlyInput } from '@/lib/china-resident-id';

export interface PatientIdentitySnapshot {
  name?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  socialSecurityNumber?: string | null;
}

export interface PatientIdentityConflictItem {
  field: 'name' | 'gender' | 'dateOfBirth' | 'socialSecurityNumber';
  label: string;
  currentValue: string;
  scannedValue: string;
}

export interface PatientIdentityConflictResult {
  hasConflict: boolean;
  items: PatientIdentityConflictItem[];
}

function normalizeName(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, '');
}

function normalizeGender(value: string | null | undefined): string {
  const normalized = (value || '').trim().toUpperCase();
  if (normalized === 'M' || normalized === 'MALE' || normalized === '男' || normalized === '男性') {
    return 'Male';
  }
  if (normalized === 'F' || normalized === 'FEMALE' || normalized === '女' || normalized === '女性') {
    return 'Female';
  }
  if (normalized === 'OTHER' || normalized === '其他') {
    return 'Other';
  }
  return '';
}

function normalizeGovernmentId(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function displayGender(value: string | null | undefined): string {
  const normalized = normalizeGender(value);
  if (normalized === 'Male') return '男';
  if (normalized === 'Female') return '女';
  if (normalized === 'Other') return '其他';
  return value?.trim() || '未填写';
}

export function detectPatientIdentityConflicts(
  current: PatientIdentitySnapshot,
  scanned: PatientIdentitySnapshot
): PatientIdentityConflictResult {
  const items: PatientIdentityConflictItem[] = [];

  const currentName = normalizeName(current.name);
  const scannedName = normalizeName(scanned.name);
  if (currentName && scannedName && currentName !== scannedName) {
    items.push({
      field: 'name',
      label: '姓名',
      currentValue: current.name?.trim() || '未填写',
      scannedValue: scanned.name?.trim() || '未填写',
    });
  }

  const currentGender = normalizeGender(current.gender);
  const scannedGender = normalizeGender(scanned.gender);
  if (currentGender && scannedGender && currentGender !== scannedGender) {
    items.push({
      field: 'gender',
      label: '性别',
      currentValue: displayGender(current.gender),
      scannedValue: displayGender(scanned.gender),
    });
  }

  const currentDateOfBirth = normalizeDateOnlyInput(current.dateOfBirth);
  const scannedDateOfBirth = normalizeDateOnlyInput(scanned.dateOfBirth);
  if (
    currentDateOfBirth &&
    scannedDateOfBirth &&
    currentDateOfBirth !== scannedDateOfBirth
  ) {
    items.push({
      field: 'dateOfBirth',
      label: '出生日期',
      currentValue: currentDateOfBirth,
      scannedValue: scannedDateOfBirth,
    });
  }

  const currentGovernmentId = normalizeGovernmentId(current.socialSecurityNumber);
  const scannedGovernmentId = normalizeGovernmentId(scanned.socialSecurityNumber);
  if (
    currentGovernmentId &&
    scannedGovernmentId &&
    currentGovernmentId !== scannedGovernmentId
  ) {
    items.push({
      field: 'socialSecurityNumber',
      label: '社保号',
      currentValue: currentGovernmentId,
      scannedValue: scannedGovernmentId,
    });
  }

  return {
    hasConflict: items.length > 0,
    items,
  };
}
