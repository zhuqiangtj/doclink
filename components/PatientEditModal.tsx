'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { FaPen, FaPlus, FaSave, FaTimes } from 'react-icons/fa';

import {
  checkResidentIdConsistency,
  getResidentIdValidationError,
} from '@/lib/china-resident-id';
import {
  detectPatientIdentityConflicts,
  type PatientIdentityConflictItem,
} from '@/lib/patient-identity-conflict';
import PatientDocumentScanner, {
  PatientDocumentScanResult,
} from '@/components/PatientDocumentScanner';

export interface EditablePatientData {
  id: string;
  username?: string | null;
  name: string;
  gender: string | null;
  dateOfBirth?: string | null;
  age: number | null;
  phone: string | null;
  socialSecurityNumber?: string | null;
  credibilityScore: number;
  visitCount: number;
  noShowCount: number;
  totalAppointments: number;
}

export interface PatientEditPayload {
  name: string;
  gender: 'Male' | 'Female' | 'Other';
  dateOfBirth: string;
  phone: string;
  socialSecurityNumber?: string;
  password?: string;
}

interface PatientEditModalProps {
  isOpen: boolean;
  patient: EditablePatientData | null;
  isSaving?: boolean;
  mode?: 'edit' | 'create';
  requireSocialSecurityNumber?: boolean;
  onClose: () => void;
  onSave: (patientId: string, payload: PatientEditPayload) => Promise<void>;
}

function normalizeGender(value: string | null | undefined): 'Male' | 'Female' | 'Other' | '' {
  if (!value) return '';
  if (value === 'Male' || value === 'Female' || value === 'Other') return value;

  const normalized = value.toUpperCase();
  if (normalized === 'M' || normalized === 'MALE') return 'Male';
  if (normalized === 'F' || normalized === 'FEMALE') return 'Female';
  return 'Other';
}

export default function PatientEditModal({
  isOpen,
  patient,
  isSaving = false,
  mode = 'edit',
  requireSocialSecurityNumber = false,
  onClose,
  onSave,
}: PatientEditModalProps) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other' | ''>('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [socialSecurityNumber, setSocialSecurityNumber] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [pendingScanReview, setPendingScanReview] = useState<{
    result: PatientDocumentScanResult;
    conflicts: PatientIdentityConflictItem[];
  } | null>(null);

  const isCreateMode = mode === 'create';

  useEffect(() => {
    if (!isOpen || !patient) return;

    setName(patient.name || '');
    setGender(normalizeGender(patient.gender));
    setDateOfBirth(patient.dateOfBirth || '');
    setPhone(patient.phone || (isCreateMode ? '13930555555' : ''));
    setSocialSecurityNumber(patient.socialSecurityNumber || '');
    setPassword('');
    setFormError(null);
    setPendingScanReview(null);
  }, [isCreateMode, isOpen, patient]);

  const genderText = useMemo(() => {
    if (gender === 'Male') return '男';
    if (gender === 'Female') return '女';
    if (gender === 'Other') return '其他';
    return '未填写';
  }, [gender]);

  if (!isOpen || !patient) return null;

  const applyScanResult = (result: PatientDocumentScanResult) => {
    setFormError(null);
    if (result.name) setName(result.name);
    if (result.gender) setGender(result.gender);
    if (result.dateOfBirth) setDateOfBirth(result.dateOfBirth);
    if (result.socialSecurityNumber) setSocialSecurityNumber(result.socialSecurityNumber);
  };

  const handleApplyScan = async (result: PatientDocumentScanResult) => {
    if (!patient || isCreateMode) {
      applyScanResult(result);
      return;
    }

    const conflicts = detectPatientIdentityConflicts(
      {
        name: patient.name,
        gender: patient.gender,
        dateOfBirth: patient.dateOfBirth,
        socialSecurityNumber: patient.socialSecurityNumber,
      },
      {
        name: result.name,
        gender: result.gender,
        dateOfBirth: result.dateOfBirth,
        socialSecurityNumber: result.socialSecurityNumber,
      }
    );

    if (conflicts.hasConflict) {
      setPendingScanReview({
        result,
        conflicts: conflicts.items,
      });
      return;
    }

    applyScanResult(result);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const normalizedSocialSecurityNumber = socialSecurityNumber.trim().toUpperCase();

    if (trimmedName.length < 2) {
      setFormError('姓名至少需要 2 个字。');
      return;
    }

    if (!gender) {
      setFormError('请选择性别。');
      return;
    }

    if (!dateOfBirth) {
      setFormError('请选择出生日期。');
      return;
    }

    if (!/^[1-9]\d{10}$/.test(trimmedPhone)) {
      setFormError('请输入有效的 11 位手机号码。');
      return;
    }

    if (!isCreateMode && password && password.length < 6) {
      setFormError('新密码至少需要 6 个字符。');
      return;
    }

    if (!normalizedSocialSecurityNumber && requireSocialSecurityNumber) {
      setFormError('请先通过扫描识别有效的社保号或身份证号，不能手工填写。');
      return;
    }

    if (normalizedSocialSecurityNumber) {
      const validationError = getResidentIdValidationError(normalizedSocialSecurityNumber);
      if (validationError) {
        setFormError(validationError);
        return;
      }

      const consistency = checkResidentIdConsistency({
        governmentId: normalizedSocialSecurityNumber,
        gender,
        dateOfBirth,
      });
      if (!consistency.isConsistent) {
        setFormError(consistency.message || '社保号与出生日期或性别不一致，请核对后再保存。');
        return;
      }
    }

    try {
      await onSave(patient.id, {
        name: trimmedName,
        gender,
        dateOfBirth,
        phone: trimmedPhone,
        socialSecurityNumber: normalizedSocialSecurityNumber || undefined,
        password: !isCreateMode && password ? password : undefined,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存病人信息失败。');
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              {isCreateMode ? (
                <FaPlus className="text-emerald-600" />
              ) : (
                <FaPen className="text-blue-600" />
              )}
              {isCreateMode ? '添加病人' : '编辑病人信息'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {isCreateMode
                ? '可手工填写，也可通过社保卡/身份证扫描自动补齐资料'
                : '可通过社保卡/身份证扫描补齐并覆盖识别到的字段'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving || scannerBusy}
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FaTimes />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <PatientDocumentScanner
              disabled={isSaving}
              onBusyChange={setScannerBusy}
              onScanResult={handleApplyScan}
            />

            <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-sm text-slate-600">
              <div className="flex min-w-max gap-3">
                <div className="min-w-[132px] flex-1 rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                  <p className="text-xs text-slate-400">{isCreateMode ? '用户名' : '当前用户名'}</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {isCreateMode ? '自动生成' : patient.username || '-'}
                  </p>
                </div>
                <div className="min-w-[132px] flex-1 rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                  <p className="text-xs text-slate-400">{isCreateMode ? '默认密码' : '当前性别'}</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {isCreateMode ? '123456' : genderText}
                  </p>
                </div>
                <div className="min-w-[132px] flex-1 rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                  <p className="text-xs text-slate-400">{isCreateMode ? '当前性别' : '当前积分'}</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {isCreateMode ? genderText : patient.credibilityScore}
                  </p>
                </div>
                <div className="min-w-[132px] flex-1 rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                  <p className="text-xs text-slate-400">{isCreateMode ? '建档方式' : '关联预约'}</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {isCreateMode ? '手填 / 智能扫描' : `${patient.totalAppointments} 条`}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">姓名</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  placeholder="请输入病人姓名"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">电话</span>
                <input
                  type="text"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  placeholder="请输入 11 位手机号"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">性别</span>
                <select
                  value={gender}
                  onChange={(event) =>
                    setGender(event.target.value as 'Male' | 'Female' | 'Other' | '')
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">请选择</option>
                  <option value="Male">男</option>
                  <option value="Female">女</option>
                  <option value="Other">其他</option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">出生日期</span>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(event) => setDateOfBirth(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>

            {!isCreateMode ? (
              <label className="block">
                <span className="text-sm font-medium text-slate-700">新密码</span>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    placeholder="留空则不修改；如需重置，可输入 123456"
                  />
                  <button
                    type="button"
                    onClick={() => setPassword('123456')}
                    className="shrink-0 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    填入 123456
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  仅医生编辑已有病人时可修改密码，留空表示保持原密码不变。
                </p>
              </label>
            ) : null}

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                社保号 / 身份证号
                {requireSocialSecurityNumber ? (
                  <span className="ml-1 text-red-500">*</span>
                ) : null}
              </span>
              <input
                type="text"
                value={socialSecurityNumber}
                readOnly
                className="mt-2 w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none"
                placeholder={
                  requireSocialSecurityNumber
                    ? '请通过扫描获取社保号 / 身份证号'
                    : '仅可通过扫描自动填入'
                }
              />
              <p className="mt-2 text-xs text-slate-500">
                {isCreateMode
                  ? '新建病人会自动生成用户名，默认密码为 123456；社保号只能通过扫描获取，不能手工修改。'
                  : '社保号只能通过扫描获取，不能手工修改；扫描社保卡时会优先提取社会保障号码。'}
              </p>
            </label>

            {formError && (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {formError}
              </div>
            )}
          </div>

          <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving || scannerBusy}
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving || scannerBusy}
              className={`flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300 ${
                isCreateMode ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              <FaSave />
              {isSaving ? (isCreateMode ? '创建中...' : '保存中...') : (isCreateMode ? '立即创建' : '保存修改')}
            </button>
          </div>
        </form>
      </div>

      {pendingScanReview && (
        <div className="fixed inset-0 z-[1160] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">发现社保卡信息与当前档案不一致</h3>
            <p className="mt-2 text-sm text-slate-600">
              如果继续覆盖，系统将以本次扫描出的姓名、性别、出生日期和社保号为准，更新当前病人资料。
            </p>

            <div className="mt-4 space-y-3 rounded-2xl bg-amber-50 p-4">
              {pendingScanReview.conflicts.map((item) => (
                <div key={item.field} className="text-sm text-slate-700">
                  <p className="font-medium text-slate-900">{item.label}</p>
                  <p className="mt-1">当前：{item.currentValue}</p>
                  <p>扫描：{item.scannedValue}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setPendingScanReview(null)}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                取消，保留原资料
              </button>
              <button
                type="button"
                onClick={() => {
                  applyScanResult(pendingScanReview.result);
                  setPendingScanReview(null);
                }}
                className="flex-1 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-400"
              >
                继续，用社保卡信息覆盖
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
