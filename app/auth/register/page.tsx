'use client';

import { useState, useEffect, FormEvent, forwardRef } from 'react';
import DatePicker, { registerLocale, setDefaultLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import zhCN from 'date-fns/locale/zh-CN';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import pinyin from 'pinyin';

export default function RegisterPage() {
  registerLocale('zh-CN', zhCN);
  setDefaultLocale('zh-CN');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUsernameManuallyEdited, setIsUsernameManuallyEdited] = useState(false);
  const [usernameAvailability, setUsernameAvailability] = useState<{ status: 'idle' | 'checking' | 'available' | 'taken', message: string }>({ status: 'idle', message: '' });
  const [debouncedUsername, setDebouncedUsername] = useState(username);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  const DateInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
    <input ref={ref} {...props} inputMode="numeric" className="input-base mt-2 w-full" />
  ));
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

  useEffect(() => {
    if (name && !isUsernameManuallyEdited) {
      const pinyinName = pinyin(name, { style: pinyin.STYLE_NORMAL }).flat().join('');
      setUsername(pinyinName);
    }
  }, [name, isUsernameManuallyEdited]);

  // Debounce effect for username
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedUsername(username);
    }, 500);

    return () => {
      clearTimeout(handler);
    };
  }, [username]);

  // Check username availability
  useEffect(() => {
    if (debouncedUsername.length < 3) {
      setUsernameAvailability({ status: 'idle', message: '' });
      return;
    }

    const checkUsername = async () => {
      setUsernameAvailability({ status: 'checking', message: '' });
      try {
        const res = await fetch(`/api/users/availability?username=${debouncedUsername}`);
        const data = await res.json();
        if (data.available) {
          setUsernameAvailability({ status: 'available', message: data.message });
        } else {
          setUsernameAvailability({ status: 'taken', message: data.message });
        }
    } catch (_e) {
        setUsernameAvailability({ status: 'taken', message: '无法检查用户名。' });
      }
    };

    checkUsername();
  }, [debouncedUsername]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (usernameAvailability.status !== 'available') {
      setError('用户名不可用');
      return;
    }

    if (!name || name.trim().length < 2) {
      setError('姓名至少需要2个字符');
      return;
    }

    if (!/^[1-9]\d{10}$/.test(phone)) {
      setError('请输入有效的11位手机号码');
      return;
    }

    if (!['Male', 'Female', 'Other'].includes(gender)) {
      setError('请选择有效的性别');
      return;
    }

    if (!dateOfBirth) {
      setError('请输入出生日期');
      return;
    }

    const birthDate = new Date(dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) {
      setError('请输入有效的出生日期');
      return;
    }
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    if (age < 0 || age > 150) {
      setError('请输入有效的出生日期');
      return;
    }

    if (password !== confirmPassword) {
      setError('密码不匹配');
      return;
    }

    if (!password || password.length < 6) {
      setError('密码至少需要6个字符');
      return;
    }

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, gender, dateOfBirth, username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '发生错误');
      }

      setSuccess('账户创建成功！您现在可以登录。');
      // Optional: redirect to sign-in page after a delay
      setTimeout(() => {
        router.push('/auth/signin');
      }, 2000);

    } catch (error) {
      setError(error instanceof Error ? error.message : '发生未知错误');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-10 space-y-8 bg-white rounded-2xl shadow-xl">
        <h1 className="text-3xl font-bold text-center text-foreground">创建账户</h1>
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
                <p className="text-gray-500">正在检查...</p>
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
                if (!date) { setDateOfBirth(''); return; }
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                setDateOfBirth(`${y}-${m}-${d}`);
              }}
              placeholderText="选择或直接输入 YYYY-MM-DD"
              dateFormat="yyyy-MM-dd"
              locale="zh-CN"
              showYearDropdown
              yearDropdownItemNumber={(() => { const t = new Date(); return (t.getFullYear() - (t.getFullYear() - 150) + 1); })()}
              scrollableYearDropdown
              showMonthDropdown
              withPortal
              openToDate={dateOfBirth ? undefined : (() => { const t = new Date(); return new Date(t.getFullYear() - 60, 0, 1); })()}
              minDate={(() => { const t = new Date(); return new Date(t.getFullYear() - 150, t.getMonth(), t.getDate()); })()}
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
            <label htmlFor="confirmPassword" className="block text-lg font-medium text-foreground">
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
            <div className="p-4 text-sm text-error bg-red-100 rounded-lg">
              {error}
            </div>
          )}
          {success && (
            <div className="p-4 text-sm text-success bg-green-100 rounded-lg">
              {success}
            </div>
          )}
          <div>
            <button
              type="submit"
              disabled={usernameAvailability.status !== 'available'}
              className="w-full btn btn-primary text-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              注册
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
