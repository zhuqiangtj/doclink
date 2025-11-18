'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignInPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setStage('正在验证身份…');
    setProgress(8);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setProgress(p => {
        const next = p + 4;
        return next >= 90 ? 90 : next;
      });
    }, 200);

    try {
      const result = await signIn('credentials', {
        redirect: false, // We handle redirect manually
        username,
        password,
      });

      if (result?.error) {
        setError('用户名或密码无效，请重试。');
        setSubmitting(false);
        setStage(null);
        setProgress(0);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      } else if (result?.ok) {
        setStage('正在建立会话…');
        setProgress(70);
        const session = await getSession(); // Get the updated session
        setStage('正在跳转…');
        setProgress(95);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (session?.user?.role === 'ADMIN') {
          router.push('/admin/dashboard');
        } else if (session?.user?.role === 'DOCTOR') {
          router.push('/doctor/schedule');
        } else {
          router.push('/'); // Default for PATIENT or other roles
        }
      }
    } catch (_e) {
      setError('发生未知错误，请稍后重试。');
      setSubmitting(false);
      setStage(null);
      setProgress(0);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

  useEffect(() => {
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, []);

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
              disabled={submitting}
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
              disabled={submitting}
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
              className={`w-full btn btn-primary text-lg ${submitting ? 'opacity-60 cursor-not-allowed' : ''}`}
              disabled={submitting}
            >
              {submitting ? '正在登录…' : '登录'}
            </button>
          </div>
          <div className="text-base text-center">
            <Link href="/auth/register" className="font-medium text-primary hover:underline">
              没有账户？点击注册
            </Link>
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
                <div className="h-2 bg-primary rounded transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
              </div>
              <div className="text-xs text-gray-500 text-right">{Math.min(100, Math.max(0, Math.floor(progress)))}%</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
