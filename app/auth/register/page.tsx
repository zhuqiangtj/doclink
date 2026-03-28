'use client';

import { useState, useEffect, FormEvent, forwardRef, useRef } from 'react';
import { signIn, getSession } from 'next-auth/react';
import DatePicker, { registerLocale, setDefaultLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import zhCN from 'date-fns/locale/zh-CN';
import { CheckCircle2, XCircle, Loader2, ScanSearch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import pinyin from 'pinyin';
import { fetchWithTimeout, withTimeout } from '../../../utils/network';

const DEFAULT_PASSWORD = '123456';

type ScanDocType = 'id_card' | 'medical_card' | 'auto';

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

interface UsernameAvailabilityResponse {
  available?: boolean;
  message?: string;
  suggestedUsername?: string;
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
  const TARGET_MAX_BYTES = 950 * 1024;
  const SAFE_TARGET_BYTES = 900 * 1024;

  if (file.size <= SAFE_TARGET_BYTES) {
    return file;
  }

  const image = await loadImageFromFile(file);
  const maxEdge = 1800;
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

  const qualities = [0.82, 0.68, 0.56, 0.46];
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= TARGET_MAX_BYTES) {
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'scan'}.jpg`, {
        type: 'image/jpeg',
      });
    }
  }

  throw new Error('图片仍然过大，请靠近一点重拍，或裁掉多余背景后再试。');
}

export default function RegisterPage() {
  registerLocale('zh-CN', zhCN);
  setDefaultLocale('zh-CN');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('13930555555');
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
  const [scanDocType] = useState<ScanDocType>('auto');

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

  const openScanPicker = () => {
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
    setIsScanning(true);
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
      const pinyinName = pinyin(name, { style: pinyin.STYLE_NORMAL })
        .flat()
        .join('')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
      setUsername(pinyinName);
    }
  }, [name, isUsernameManuallyEdited]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedUsername(username);
    }, isUsernameManuallyEdited ? 500 : 0);

    return () => {
      clearTimeout(handler);
    };
  }, [username, isUsernameManuallyEdited]);

  useEffect(() => {
    if (debouncedUsername.length < 3) {
      setUsernameAvailability({ status: 'idle', message: '' });
      return;
    }

    const checkUsername = async () => {
      setUsernameAvailability({ status: 'checking', message: '' });
      try {
        const res = await fetchWithTimeout(
          `/api/users/availability?username=${encodeURIComponent(debouncedUsername)}`
        );
        const data = (await res.json()) as UsernameAvailabilityResponse;
        if (data.available) {
          setUsernameAvailability({
            status: 'available',
            message: data.message || '用户名可用。',
          });
        } else if (
          !isUsernameManuallyEdited &&
          typeof data.suggestedUsername === 'string' &&
          data.suggestedUsername !== debouncedUsername
        ) {
          setUsernameAvailability({
            status: 'checking',
            message: `已自动改为 ${data.suggestedUsername}，正在检查...`,
          });
          setUsername(data.suggestedUsername);
        } else {
          setUsernameAvailability({
            status: 'taken',
            message: data.message || '用户名已占用。',
          });
        }
      } catch {
        setUsernameAvailability({ status: 'taken', message: '无法检查用户名。' });
      }
    };

    checkUsername();
  }, [debouncedUsername, isUsernameManuallyEdited]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

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

      const finalUsername =
        typeof data.username === 'string' && data.username ? data.username : username;
      setUsername(finalUsername);
      setUsernameAvailability({ status: 'available', message: '用户名可用。' });

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
            username: finalUsername,
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
        setError(`账户已创建，但自动登录失败或超时，请使用用户名 ${finalUsername} 手动登录。`);
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
      <div className="fixed right-3 top-1/2 z-40 -translate-y-1/2 md:right-4">
        <div className="rounded-3xl border border-slate-200 bg-white/92 p-2 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={openScanPicker}
            disabled={isScanning || submitting}
            title="扫描身份证或社保卡"
            aria-label="扫描身份证或社保卡"
            className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isScanning ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <ScanSearch size={18} />
            )}
            <span className="mt-1 text-[10px] font-medium leading-none">扫描</span>
          </button>
        </div>
      </div>

      <div className="w-full max-w-md p-10 space-y-8 bg-white rounded-2xl shadow-xl">
        <h1 className="text-3xl font-bold text-center text-foreground">创建账户</h1>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          capture="environment"
          className="hidden"
          onChange={handleScanFileChange}
        />

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
