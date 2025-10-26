'use client';

import { useState, FormEvent } from 'react';
import { signIn, getSession } from 'next-auth/react'; // Import getSession
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignInPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const result = await signIn('credentials', {
        redirect: false, // We handle redirect manually
        username,
        password,
      });

      if (result?.error) {
        setError('用户名或密码无效，请重试。');
      } else if (result?.ok) {
        const session = await getSession(); // Get the updated session
        if (session?.user?.role === 'ADMIN') {
          router.push('/admin/dashboard');
        } else if (session?.user?.role === 'DOCTOR') {
          router.push('/doctor/schedule');
        } else {
          router.push('/'); // Default for PATIENT or other roles
        }
      }
    } catch (error) {
      setError('发生未知错误，请稍后重试。');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-10 space-y-8 bg-white rounded-2xl shadow-xl">
        <h1 className="text-3xl font-bold text-center text-foreground">登录</h1>
        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <label htmlFor="username" className="block text-lg font-medium text-foreground">
              用户名
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-base mt-2"
            />
          </div>
          {error && (
            <div className="p-4 text-sm text-error bg-red-100 rounded-lg">
              {error}
            </div>
          )}
          <div>
            <button
              type="submit"
              className="w-full btn btn-primary text-lg"
            >
              登录
            </button>
          </div>
          <div className="text-base text-center">
            <Link href="/auth/register" className="font-medium text-primary hover:underline">
              没有账户？点击注册
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
