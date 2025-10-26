'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import pinyin from 'pinyin';

export default function RegisterPage() {
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
      } catch (err) {
        setUsernameAvailability({ status: 'taken', message: '无法检查用户名。' });
      }
    };

    checkUsername();
  }, [debouncedUsername]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password !== confirmPassword) {
      setError('密码不匹配');
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
              {usernameAvailability.status === 'checking' && <p className='text-gray-500'>正在检查...</p>}
              {usernameAvailability.status === 'available' && <p className='text-green-500'>鉁 {usernameAvailability.message}</p>}
              {usernameAvailability.status === 'taken' && <p className='text-error'>âŒ {usernameAvailability.message}</p>}
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
            <label htmlFor="dateOfBirth" className="block text-lg font-medium text-foreground">
              出生日期
            </label>
            <input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="input-base mt-2"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-lg font-medium text-foreground">
              电话（可选）
            </label>
            <input
              id="phone"
              name="phone"
              type="text"
              autoComplete="tel"
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
