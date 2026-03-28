'use client';

import { useState, useEffect, FormEvent, forwardRef, useRef } from 'react';
import { signIn, getSession } from 'next-auth/react';
import DatePicker, { registerLocale, setDefaultLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import zhCN from 'date-fns/locale/zh-CN';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import pinyin from 'pinyin';
import { fetchWithTimeout, withTimeout } from '../../../utils/network';

const DEFAULT_PASSWORD = '123456';

type ScanDocType = 'id_card' | 'medical_card';

interface ScanResponse {
  name: string;
  gender: 'Male' | 'Female' | 'Other' | null;
  dateOfBirth: string | null;
  password: string;
  confirmPassword: string;
  confidence: number | null;
  detectedDocumentType: 'id_card' | 'medical_card' | 'unknown';
  notes: string;
  shouldReview: boolean;
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('无法读取图片，请重新选择。'));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片压缩失败，请重试。'));
    }, type, quality);
  });
}

async function prepareImageForVercelUpload(file: File): Promise<File> {
  const TARGET_MAX_BYTES = 4 * 1024 * 1024;
  const SAFE_TARGET_BYTES = 3_800_000;

  if (file.size <= SAFE_TARGET_BYTES) {
    return file;
  }

  const image = await loadImageFromFile(file);
  const maxEdge = 2000;
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前浏览器不支持图片压缩，请换一个浏览器重试。');
  }
  context.drawImage(image, 0, 0, width, height);

  const qualities = [0.86, 0.74, 0.62];
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= TARGET_MAX_BYTES) {
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'scan'}.jpg`, {
        type: 'image/jpeg',
      });
    }
  }

  throw new Error('图片过大，请靠近一点重拍，或裁掉多余背景后再试。');
}

export default function RegisterPage() {
  registerLocale('zh-CN', zhCN);
  setDefaultLocale('zh-CN');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [confirmPassword, setConfirmPassword] = useState(DEFAULT_PASSWORD);
  const [isUsernameManuallyEdited, setIsUsernameManuallyEdited] = useState(false);
  const [usernameAvailability, setUsernameAvailability] = useState<{
    status: 'idle' | 'checking' | 'available' | 'taken';
    message: string;
  }>({ status: 'idle', message: '' });
  const [debouncedUsername, setDebouncedUsername] = useState(username);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanDocType, setScanDocType] = useState<ScanDocType>('id_card');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanNotes, setScanNotes] = useState<string | null>(null);
  const [scanConfidence, setScanConfidence] = useState<number | null>(null);
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);
  const [lastScannedDocLabel, setLastScannedDocLabel] = useState<string | null>(null);

  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const DateInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => (
      <input ref={ref} {...props} inputMode="numeric" className="input-base mt-2 w-full" />
    )
  );
  DateInput.displayName = 'DateInput';

  const setDOBFromInput = (raw: string) => {
    const normalized = raw
      .replace(/[年|月|日]/g, '-')
      .replace(/[./]/g, '-')
      .replace(/\s+/g, '')
      .replace(/-+/g, '-')
      .trim();
    const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return;
    const y = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm < 1 || mm > 12) return;
    const test = new Date(y, mm - 1, dd);
    if (test.getFullYear() !== y || test.getMonth() !== mm - 1 || test.getDate() !== dd) return;
    const t = new Date();
    const age = t.getFullYear() - y;
    if (age < 0 || age > 150) return;
    const pmm = String(mm).padStart(2, '0');
    const pdd = String(dd).padStart(2, '0');
    setDateOfBirth(`${y}-${pmm}-${pdd}`);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setDOBFromInput(e.target.value);
  };

  const stopSubmitting = () => {
    setSubmitting(false);
    setStage(null);
    setProgress(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const openScanPicker = (docType: ScanDocType) => {
    setScanDocType(docType);
    setScanMessage(null);
    setScanNotes(null);
    setScanConfidence(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleScanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const currentDocType = scanDocType;
    const currentDocLabel =
      currentDocType === 'id_card' ? '身份证' : '天津医保卡/社保卡';

    if (scanPreviewUrl) {
      URL.revokeObjectURL(scanPreviewUrl);
    }
    setScanPreviewUrl(URL.createObjectURL(file));
    setLastScannedDocLabel(currentDocLabel);
    setIsScanning(true);
    setScanMessage(null);
    setScanNotes(null);
    setScanConfidence(null);
    setError(null);
    setSuccess(null);

    try {
      const uploadFile = await prepareImageForVercelUpload(file);
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('docType', currentDocType);

      const response = await fetchWithTimeout(
        '/api/ocr/patient-registration',
        {
          method: 'POST',
          body: formData,
        },
        45000
      );

      const data = (await response.json()) as ScanResponse | { error?: string };
      if (!response.ok) {
        throw new Error(
          'error' in data && typeof data.error === 'string'
            ? data.error
            : '证件识别失败，请重试。'
        );
      }

      const result = data as ScanResponse;

      if (result.name) {
        setIsUsernameManuallyEdited(false);
        setName(result.name);
      }
      if (result.gender) {
        setGender(result.gender);
      }
      if (result.dateOfBirth) {
        setDateOfBirth(result.dateOfBirth);
      }
      setPassword(result.password || DEFAULT_PASSWORD);
      setConfirmPassword(result.confirmPassword || result.password || DEFAULT_PASSWORD);
      setScanNotes(result.notes || null);
      setScanConfidence(
        typeof result.confidence === 'number' ? result.confidence : null
      );

      const filledFields = [
        result.name ? '姓名' : '',
        result.gender ? '性别' : '',
        result.dateOfBirth ? '出生日期' : '',
      ].filter(Boolean);

      setScanMessage(
        result.shouldReview
          ? `已识别${filledFields.length > 0 ? filledFields.join('、') : '部分字段'}，请人工核对后再提交。`
          : `已自动填写${filledFields.join('、')}，密码默认已填为 ${DEFAULT_PASSWORD}。`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '证件识别失败，请重试。');
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  useEffect(() => {
    if (name && !isUsernameManuallyEdited) {
      const pinyinName = pinyin(name, { style: pinyin.STYLE_NORMAL }).flat().join('');
      setUsername(pinyinName);
    }
  }, [name, isUsernameManuallyEdited]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedUsername(username);
    }, 500);

    return () => {
      clearTimeout(handler);
    };
  }, [username]);

  useEffect(() => {
    if (debouncedUsername.length < 3) {
      setUsernameAvailability({ status: 'idle', message: '' });
      return;
    }

    const checkUsername = async () => {
      setUsernameAvailability({ status: 'checking', message: '' });
      try {
        const res = await fetchWithTimeout(
          `/api/users/availability?username=${debouncedUsername}`
        );
        const data = await res.json();
        if (data.available) {
          setUsernameAvailability({ status: 'available', message: data.message });
        } else {
          setUsernameAvailability({ status: 'taken', message: data.message });
        }
      } catch {
        setUsernameAvailability({ status: 'taken', message: '无法检查用户名。' });
      }
    };

    checkUsername();
  }, [debouncedUsername]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scanPreviewUrl) {
        URL.revokeObjectURL(scanPreviewUrl);
      }
    };
  }, [scanPreviewUrl]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    setStage('正在创建账户…');
    setProgress(8);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setProgress((p) => {
        const next = p + 4;
        return next >= 90 ? 90 : next;
      });
    }, 200);

    if (usernameAvailability.status !== 'available') {
      setError('用户名不可用');
      stopSubmitting();
      return;
    }

    if (!name || name.trim().length < 2) {
      setError('姓名至少需要2个字符');
      stopSubmitting();
      return;
    }

    if (!/^[1-9]\d{10}$/.test(phone)) {
      setError('请输入有效的11位手机号码');
      stopSubmitting();
      return;
    }

    if (!['Male', 'Female', 'Other'].includes(gender)) {
      setError('请选择有效的性别');
      stopSubmitting();
      return;
    }

    if (!dateOfBirth) {
      setError('请输入出生日期');
      stopSubmitting();
      return;
    }

    const birthDate = new Date(dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) {
      setError('请输入有效的出生日期');
      stopSubmitting();
      return;
    }
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    if (age < 0 || age > 150) {
      setError('请输入有效的出生日期');
      stopSubmitting();
      return;
    }

    if (password !== confirmPassword) {
      setError('密码不匹配');
      stopSubmitting();
      return;
    }

    if (!password || password.length < 6) {
      setError('密码至少需要6个字符');
      stopSubmitting();
      return;
    }

    try {
      const response = await fetchWithTimeout(
        '/api/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            phone,
            gender,
            dateOfBirth,
            username,
            password,
          }),
        },
        20000
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '发生错误');
      }

      setSuccess('账户创建成功！正在登录…');
      setStage('注册成功，正在登录…');
      setProgress(92);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      try {
        const loginResult = await withTimeout(
          signIn('credentials', {
            redirect: false,
            username,
            password,
          }),
          15000,
          '自动登录超时'
        );

        if (loginResult?.error) {
          throw new Error('自动登录失败');
        }

        setStage('正在建立会话…');
        setProgress(96);

        const session = await withTimeout(
          getSession(),
          10000,
          '获取会话超时'
        );

        setStage('正在跳转…');
        setProgress(100);

        if (session?.user?.role === 'ADMIN') {
          router.push('/admin/dashboard');
        } else if (session?.user?.role === 'DOCTOR') {
          router.push('/doctor/schedule');
        } else {
          router.push('/');
        }
      } catch (loginErr) {
        console.warn('Auto-login failed:', loginErr);
        setSuccess(null);
        setError('账户已创建，但自动登录失败或超时，请前往登录页面手动登录。');
        stopSubmitting();
        setTimeout(() => router.push('/auth/signin'), 2000);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : '发生未知错误'
      );
      stopSubmitting();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-10 space-y-8 bg-white rounded-2xl shadow-xl">
        <h1 className="text-3xl font-bold text-center text-foreground">创建账户</h1>

        <div className="rounded-2xl border border-dashed border-blue-300 bg-blue-50/80 p-4 space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">证件扫描自动填写</h2>
            <p className="text-sm text-gray-600 leading-6">
              支持拍照或上传身份证正面，以及天津医保卡/社保卡中带姓名等信息的一面。识别后仍可手动修改。
            </p>
            <p className="text-xs text-gray-500 leading-6">
              轻微倾斜、稍微歪一点通常也能识别；但仍建议尽量拍完整卡面，避免强反光和严重模糊。
            </p>
            <p className="text-xs text-gray-500 leading-6">
              如果部署在 Vercel，系统会尽量自动压缩大图；单张图片仍建议控制在 4MB 以内。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => openScanPicker('id_card')}
              disabled={isScanning || submitting}
              className="btn btn-primary text-sm"
            >
              {isScanning && scanDocType === 'id_card' ? '正在识别身份证…' : '扫描身份证'}
            </button>
            <button
              type="button"
              onClick={() => openScanPicker('medical_card')}
              disabled={isScanning || submitting}
              className="btn btn-secondary text-sm"
            >
              {isScanning && scanDocType === 'medical_card'
                ? '正在识别医保卡…'
                : '扫描天津医保卡/社保卡'}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            capture="environment"
            className="hidden"
            onChange={handleScanFileChange}
          />

          {isScanning && (
            <div className="rounded-xl bg-white/90 border border-blue-100 px-4 py-3 text-sm text-blue-700 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              正在识别证件，请稍候…
            </div>
          )}

          {(scanMessage || scanNotes || scanPreviewUrl) && (
            <div className="rounded-xl bg-white/90 border border-blue-100 p-3 space-y-3">
              {scanPreviewUrl && (
                <img
                  src={scanPreviewUrl}
                  alt="证件预览"
                  className="w-full h-40 object-cover rounded-lg border border-gray-200"
                />
              )}
              {lastScannedDocLabel && (
                <p className="text-sm text-gray-700">
                  最近识别证件：{lastScannedDocLabel}
                  {typeof scanConfidence === 'number'
                    ? `（置信度约 ${Math.round(scanConfidence * 100)}%）`
                    : ''}
                </p>
              )}
              {scanMessage && (
                <p className="text-sm text-green-700 leading-6">{scanMessage}</p>
              )}
              {scanNotes && (
                <p className="text-xs text-gray-500 leading-6">识别说明：{scanNotes}</p>
              )}
            </div>
          )}

          <p className="text-xs text-gray-500 leading-6">
            密码默认已自动填为 {DEFAULT_PASSWORD}，提交前可手动修改。证件图片不会在本系统中保存，请在识别后人工核对。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <label htmlFor="name" className="block text-lg font-medium text-foreground">
              姓名
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setIsUsernameManuallyEdited(false);
              }}
              className="input-base mt-2"
            />
          </div>

          <div>
            <label htmlFor="username" className="block text-lg font-medium text-foreground">
              用户名 (可修改)
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setIsUsernameManuallyEdited(true);
              }}
              className="input-base mt-2"
            />
            <div className="mt-2 text-sm h-5">
              {usernameAvailability.status === 'checking' && (
                <p className="text-gray-500 flex items-center gap-1">
                  <Loader2 size={16} className="animate-spin" />
                  正在检查...
                </p>
              )}
              {usernameAvailability.status === 'available' && (
                <p className="text-success flex items-center gap-1">
                  <CheckCircle2 size={16} />
                  {usernameAvailability.message || '用户名可用'}
                </p>
              )}
              {usernameAvailability.status === 'taken' && (
                <p className="text-error flex items-center gap-1">
                  <XCircle size={16} />
                  {usernameAvailability.message || '用户名已占用'}
                </p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="gender" className="block text-lg font-medium text-foreground">
              性别
            </label>
            <select
              id="gender"
              name="gender"
              required
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="input-base mt-2"
            >
              <option value="">选择性别</option>
              <option value="Male">男</option>
              <option value="Female">女</option>
              <option value="Other">其他</option>
            </select>
          </div>

          <div>
            <label className="block text-lg font-medium text-foreground">出生日期</label>
            <DatePicker
              selected={dateOfBirth ? new Date(dateOfBirth) : null}
              onChange={(date: Date | null) => {
                if (!date) {
                  setDateOfBirth('');
                  return;
                }
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                setDateOfBirth(`${y}-${m}-${d}`);
              }}
              placeholderText="选择或直接输入 YYYY-MM-DD"
              dateFormat="yyyy-MM-dd"
              locale="zh-CN"
              showYearDropdown
              yearDropdownItemNumber={(() => {
                const t = new Date();
                return t.getFullYear() - (t.getFullYear() - 150) + 1;
              })()}
              scrollableYearDropdown
              showMonthDropdown
              withPortal
              openToDate={
                dateOfBirth
                  ? undefined
                  : (() => {
                      const t = new Date();
                      return new Date(t.getFullYear() - 60, 0, 1);
                    })()
              }
              minDate={(() => {
                const t = new Date();
                return new Date(t.getFullYear() - 150, t.getMonth(), t.getDate());
              })()}
              maxDate={new Date()}
              onBlur={handleBlur}
              customInput={<DateInput />}
              shouldCloseOnSelect
              required
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-lg font-medium text-foreground">
              电话（必填）
            </label>
            <input
              id="phone"
              name="phone"
              type="text"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input-base mt-2"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-lg font-medium text-foreground">
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-base mt-2"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-lg font-medium text-foreground"
            >
              确认密码
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input-base mt-2"
            />
          </div>

          {error && (
            <div className="p-4 text-sm text-error bg-red-100 rounded-lg">{error}</div>
          )}
          {success && (
            <div className="p-4 text-sm text-success bg-green-100 rounded-lg">
              {success}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={
                usernameAvailability.status !== 'available' || submitting || isScanning
              }
              className="w-full btn btn-primary text-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              注册
            </button>
          </div>
        </form>

        {submitting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-80 bg-white rounded-xl p-6 shadow-xl space-y-4">
              <div className="flex items-center space-x-3">
                <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <div className="text-sm text-foreground">{stage || '正在处理…'}</div>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded">
                <div
                  className="h-2 bg-primary rounded transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, progress))}%`,
                  }}
                />
              </div>
              <div className="text-xs text-gray-500 text-right">
                {Math.min(100, Math.max(0, Math.floor(progress)))}%
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
