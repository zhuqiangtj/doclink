'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { withTimeout } from '../../../utils/network';

export default function SignInPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [showTimeout, setShowTimeout] = useState(false);
  const [targetPath, setTargetPath] = useState<string>('/');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setShowTimeout(false);
    if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);

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
      // 1. SignIn with timeout (20s)
      const result = await withTimeout(
        signIn('credentials', {
          redirect: false, 
          username,
          password,
        }),
        20000,
        '登录请求超时，请检查网络'
      );

      if (result?.error) {
        setError('用户名或密码无效，请重试。');
        setSubmitting(false);
        setStage(null);
        setProgress(0);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      } else if (result?.ok) {
        setStage('正在建立会话…');
        setProgress(92); // Jump to 92 directly to avoid backward jump if auto-progress reached 90
        
        // 2. GetSession with timeout (10s)
        // Note: getSession might return null if something is wrong, but usually returns session
        const session = await withTimeout(
          getSession(),
          10000,
          '获取会话超时，请刷新页面重试'
        );

        setStage('正在跳转…');
        setProgress(100);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

        let path = '/';
        if (session?.user?.role === 'ADMIN') {
          path = '/admin/dashboard';
        } else if (session?.user?.role === 'DOCTOR') {
          path = '/doctor/schedule';
        }
        setTargetPath(path);

        // Start navigation timeout
        if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);
        navigationTimeoutRef.current = setTimeout(() => {
          setShowTimeout(true);
        }, 8000); // Reduce navigation timeout to 8s

        router.push(path);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '发生未知错误，请稍后重试。';
      setError(errMsg);
      setSubmitting(false);
      setStage(null);
      setProgress(0);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (navigationTimeoutRef.current) { clearTimeout(navigationTimeoutRef.current); navigationTimeoutRef.current = null; }
    }
  };

  useEffect(() => {
    return () => { 
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (navigationTimeoutRef.current) { clearTimeout(navigationTimeoutRef.current); navigationTimeoutRef.current = null; }
    };
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
              {showTimeout ? (
                <div className="flex flex-col items-center text-center">
                  <div className="text-red-400 text-4xl mb-3">⚠️</div>
                  <h3 className="font-bold text-lg mb-2">网络连接超时</h3>
                  <p className="text-sm text-gray-500 mb-6">
                    登录已完成，但跳转页面时响应过慢。
                  </p>
                  <div className="flex space-x-3 w-full">
                    <button 
                      type="button"
                      onClick={() => {
                        setShowTimeout(false);
                        setSubmitting(false);
                        setProgress(0);
                        setStage(null);
                      }}
                      className="flex-1 btn btn-outline text-sm py-2"
                    >
                      重新登录
                    </button>
                    <button 
                      type="button"
                      onClick={() => {
                        window.location.href = targetPath;
                      }}
                      className="flex-1 btn btn-primary text-sm py-2"
                    >
                      强制跳转
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center space-x-3">
                    <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    <div className="text-sm text-foreground">{stage || '正在处理…'}</div>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded">
                    <div className="h-2 bg-primary rounded transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
                  </div>
                  <div className="text-xs text-gray-500 text-right">{Math.min(100, Math.max(0, Math.floor(progress)))}%</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
