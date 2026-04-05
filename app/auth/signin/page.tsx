'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { getSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import PatientDocumentScanner, {
  PatientDocumentScanResult,
} from '@/components/PatientDocumentScanner';
import { fetchWithTimeout, withTimeout } from '../../../utils/network';

interface PatientCardLoginVerifyResponse {
  error?: string;
  user?: {
    id: string;
    username: string;
    name: string;
  };
}

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

  const clearProgressTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearNavigationTimeout = () => {
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }
  };

  const resetSubmittingState = () => {
    clearProgressTimer();
    clearNavigationTimeout();
    setSubmitting(false);
    setShowTimeout(false);
    setStage(null);
    setProgress(0);
  };

  const startSubmittingProgress = (message: string, initialProgress = 8) => {
    clearProgressTimer();
    clearNavigationTimeout();
    setSubmitting(true);
    setShowTimeout(false);
    setStage(message);
    setProgress(initialProgress);
    timerRef.current = setInterval(() => {
      setProgress((current) => {
        const next = current + 4;
        return next >= 90 ? 90 : next;
      });
    }, 200);
  };

  const finishWithError = (message: string) => {
    setError(message);
    resetSubmittingState();
  };

  const redirectAfterAuth = async () => {
    setStage('正在建立会话…');
    setProgress((current) => Math.max(current, 92));

    const session = await withTimeout(
      getSession(),
      10000,
      '获取会话超时，请刷新页面重试'
    );

    setStage('正在跳转…');
    setProgress(100);
    clearProgressTimer();

    let path = '/';
    if (session?.user?.role === 'ADMIN') {
      path = '/admin/dashboard';
    } else if (session?.user?.role === 'DOCTOR') {
      path = '/doctor/schedule';
    }

    setTargetPath(path);
    clearNavigationTimeout();
    navigationTimeoutRef.current = setTimeout(() => {
      setShowTimeout(true);
    }, 8000);

    router.push(path);
  };

  const performProviderSignIn = async (
    provider: 'credentials' | 'patient-card-login',
    payload: Record<string, string>,
    invalidMessage: string
  ) => {
    const result = await withTimeout(
      signIn(provider, {
        redirect: false,
        ...payload,
      }),
      20000,
      provider === 'credentials' ? '登录请求超时，请检查网络' : '证件登录超时，请检查网络'
    );

    if (!result?.ok || result.error) {
      throw new Error(invalidMessage);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    startSubmittingProgress('正在验证身份…', 8);

    try {
      await performProviderSignIn(
        'credentials',
        {
          username,
          password,
        },
        '用户名或密码无效，请重试。'
      );
      await redirectAfterAuth();
    } catch (authError) {
      finishWithError(
        authError instanceof Error ? authError.message : '发生未知错误，请稍后重试。'
      );
    }
  };

  const handlePatientCardLogin = async (scanResult: PatientDocumentScanResult) => {
    setError(null);

    if (scanResult.detectedDocumentType !== 'medical_card') {
      setError('证件登录请扫描病人的社保卡或医保卡，不能使用其他证件。');
      return;
    }

    if (!scanResult.socialSecurityNumber) {
      setError('未识别到有效社保号，请重新扫描。');
      return;
    }

    startSubmittingProgress('已识别社保卡，正在核对证件信息…', 12);

    try {
      const verifyResponse = await fetchWithTimeout(
        '/api/auth/patient-card-login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            socialSecurityNumber: scanResult.socialSecurityNumber,
            name: scanResult.name || '',
            gender: scanResult.gender || '',
            dateOfBirth: scanResult.dateOfBirth || '',
            detectedDocumentType: scanResult.detectedDocumentType,
          }),
        },
        20000
      );

      const verifyData =
        (await verifyResponse.json().catch(() => null)) as PatientCardLoginVerifyResponse | null;

      if (!verifyResponse.ok) {
        throw new Error(verifyData?.error || '证件登录失败，请稍后重试。');
      }

      setStage(
        verifyData?.user?.name
          ? `已匹配病人 ${verifyData.user.name}，正在建立会话…`
          : '已匹配病人账户，正在建立会话…'
      );
      setProgress(64);

      await performProviderSignIn(
        'patient-card-login',
        {
          socialSecurityNumber: scanResult.socialSecurityNumber,
          name: scanResult.name || '',
          gender: scanResult.gender || '',
          dateOfBirth: scanResult.dateOfBirth || '',
        },
        '证件登录失败，请稍后重试。'
      );

      await redirectAfterAuth();
    } catch (authError) {
      finishWithError(
        authError instanceof Error ? authError.message : '证件登录失败，请稍后重试。'
      );
    }
  };

  useEffect(() => {
    return () => {
      clearProgressTimer();
      clearNavigationTimeout();
    };
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <PatientDocumentScanner
        disabled={submitting}
        variant="floating"
        floatingLabel="证件登录"
        cameraSubtitle="请对准病人社保卡或医保卡，自动对焦后拍照识别"
        onScanResult={handlePatientCardLogin}
      />

      <div className="w-full max-w-md rounded-2xl bg-white p-10 shadow-xl">
        <h1 className="text-center text-3xl font-bold text-foreground">登录</h1>
        <form onSubmit={handleSubmit} className="mt-8 space-y-8">
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
              onChange={(event) => setUsername(event.target.value)}
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
              onChange={(event) => setPassword(event.target.value)}
              className="input-base mt-2"
              disabled={submitting}
            />
          </div>
          {error && (
            <div className="rounded-lg bg-red-100 p-4 text-sm text-error">
              {error}
            </div>
          )}
          <div>
            <button
              type="submit"
              className={`w-full btn btn-primary text-lg ${
                submitting ? 'cursor-not-allowed opacity-60' : ''
              }`}
              disabled={submitting}
            >
              {submitting ? '正在登录…' : '登录'}
            </button>
          </div>
          <div className="text-center text-base">
            <Link href="/auth/register" className="font-medium text-primary hover:underline">
              没有账户？点击注册
            </Link>
          </div>
        </form>

        {submitting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-80 space-y-4 rounded-xl bg-white p-6 shadow-xl">
              {showTimeout ? (
                <div className="flex flex-col items-center text-center">
                  <div className="mb-3 text-4xl text-red-400">⚠️</div>
                  <h3 className="mb-2 text-lg font-bold">网络连接超时</h3>
                  <p className="mb-6 text-sm text-gray-500">
                    登录已完成，但跳转页面时响应过慢。
                  </p>
                  <div className="flex w-full space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        resetSubmittingState();
                      }}
                      className="flex-1 btn btn-outline py-2 text-sm"
                    >
                      重新登录
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = targetPath;
                      }}
                      className="flex-1 btn btn-primary py-2 text-sm"
                    >
                      强制跳转
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center space-x-3">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <div className="text-sm text-foreground">{stage || '正在处理…'}</div>
                  </div>
                  <div className="h-2 w-full rounded bg-gray-200">
                    <div
                      className="h-2 rounded bg-primary transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    />
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    {Math.min(100, Math.max(0, Math.floor(progress)))}%
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
