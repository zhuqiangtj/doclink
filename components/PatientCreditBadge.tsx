'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { fetchWithTimeout } from '../utils/network';

interface UserResponse {
  id: string;
  username: string;
  patientProfile?: { id: string; credibilityScore?: number; } | null;
}

export default function PatientCreditBadge() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // 認證相關頁面（登入/註冊）判斷，在所有 Hooks 之後再決定是否渲染
  const isAuthPage = !!(pathname && pathname.startsWith('/auth'));

  const isPatient = status === 'authenticated' && session?.user?.role === 'PATIENT';

  useEffect(() => {
    const fetchScore = async () => {
      if (!isPatient) return;
      setLoading(true);
      try {
        const res = await fetchWithTimeout('/api/user');
        if (!res.ok) throw new Error('Failed to fetch user');
        const data: UserResponse = await res.json();
        const s = data?.patientProfile?.credibilityScore;
        setScore(typeof s === 'number' ? s : null);
      } catch (e) {
        console.warn('Failed to load patient credibility score:', e);
        setScore(null);
      } finally {
        setLoading(false);
      }
    };
    fetchScore();
  }, [isPatient]);

  const colorClass = useMemo(() => {
    if (score == null) return 'credit-neutral';
    if (score >= 15) return 'credit-good';
    if (score >= 10) return 'credit-medium';
    return 'credit-low';
  }, [score]);

  // 在所有 Hooks 之後進行條件返回，避免 Hooks 順序變化
  if (isAuthPage || !isPatient) return null;

  return (
    <div className={`patient-credit-badge ${colorClass}`} aria-live="polite" aria-label="患者积分">
      <span className="credit-label">積分</span>
      <span className="credit-value">{loading ? '…' : (score ?? '—')}</span>
    </div>
  );
}