'use client';

import { useState, useEffect, FormEvent, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import PatientDocumentScanner, {
  PatientDocumentScanResult,
} from '@/components/PatientDocumentScanner';
import {
  detectPatientIdentityConflicts,
  type PatientIdentityConflictItem,
  type PatientIdentitySnapshot,
} from '@/lib/patient-identity-conflict';
import { fetchWithTimeout } from '../../utils/network';
import './mobile.css';

export default function SettingsPage() {
  const { data: session, status, update } = useSession();

  // Profile states
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [socialSecurityNumber, setSocialSecurityNumber] = useState('');
  const [profileScannerBusy, setProfileScannerBusy] = useState(false);
  const [profileBaseline, setProfileBaseline] = useState<PatientIdentitySnapshot | null>(null);
  const [pendingScanReview, setPendingScanReview] = useState<{
    result: PatientDocumentScanResult;
    conflicts: PatientIdentityConflictItem[];
  } | null>(null);
  
  // Password states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [credibilityScore, setCredibilityScore] = useState<number | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  // UI states
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const lastSnapRef = useRef<string>('');

  useEffect(() => {
    if (status === 'authenticated') {
      setUsername(session.user.username || '');
      setName(session.user.name || '');
      setPhone(session.user.phone || '');
      if (session.user.dateOfBirth) {
        const d = new Date(session.user.dateOfBirth);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        setDateOfBirth(`${y}-${m}-${day}`);
      } else {
        setDateOfBirth('');
      }
      setGender(session.user.gender || '');
      setSocialSecurityNumber('');
    }
  }, [status, session]);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role === 'PATIENT') {
      const run = async () => {
        setScoreLoading(true);
        try {
          const res = await fetchWithTimeout('/api/user');
          if (res.ok) {
            const data = await res.json();
            const s = data?.patientProfile?.credibilityScore;
            setCredibilityScore(typeof s === 'number' ? s : null);
          } else {
            setCredibilityScore(null);
          }
        } catch {
          setCredibilityScore(null);
        } finally {
          setScoreLoading(false);
        }
      };
      run();
    } else {
      setCredibilityScore(null);
    }
  }, [status, session]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const sync = async () => {
      try {
        const res = await fetchWithTimeout('/api/user', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const dobVal = data?.dateOfBirth ? (() => { const d = new Date(data.dateOfBirth); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; })() : '';
        const scoreVal = typeof data?.patientProfile?.credibilityScore === 'number' ? data.patientProfile.credibilityScore : null;
        const socialSecurityNumberVal = data?.socialSecurityNumber || '';
        const snap = JSON.stringify({ u: data?.username || '', n: data?.name || '', p: data?.phone || '', dob: dobVal, g: data?.gender || '', ssn: socialSecurityNumberVal, s: scoreVal });
        const changed = lastSnapRef.current && lastSnapRef.current !== snap;
        lastSnapRef.current = snap;
        setUsername(data?.username || '');
        setName(data?.name || '');
        setPhone(data?.phone || '');
        setDateOfBirth(dobVal);
        setGender(data?.gender || '');
        setSocialSecurityNumber(socialSecurityNumberVal);
        setProfileBaseline({
          name: data?.name || '',
          gender: data?.gender || '',
          dateOfBirth: dobVal,
          socialSecurityNumber: socialSecurityNumberVal,
        });
        setCredibilityScore(scoreVal);
        if (changed) setOverlayText('已自动更新');
      } catch {}
    };
    sync();
    timer = setInterval(sync, 60000);
    const onFocus = () => { sync(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') sync(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status]);

  useEffect(() => {
    if (!overlayText) return;
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  useEffect(() => {
    if (error) setOverlayText(error);
  }, [error]);

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Form validation
    if (phone && !/^[1-9]\d{10}$/.test(phone)) {
      setError('请输入有效的11位手机号码');
      return;
    }

    if (dateOfBirth) {
      const birthDate = new Date(dateOfBirth);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      if (age < 0 || age > 150) {
        setError('请输入有效的出生日期');
        return;
      }
    }

    if (name && name.trim().length < 2) {
      setError('姓名至少需要2个字符');
      return;
    }

    try {
      const response = await fetchWithTimeout('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, name, phone, dateOfBirth, gender, socialSecurityNumber }),
      });
      if (!response.ok) {
        const data = await response
          .json()
          .catch(() => null) as { error?: string; existingUsername?: string } | null;
        throw new Error(data?.error || '更新个人资料失败。');
      }
      setSuccess('个人资料更新成功！');
      // Update session if needed
      await update();
    } catch (err) { setError(err instanceof Error ? err.message : '更新失败'); }
  };

  const applyScannedProfile = (result: PatientDocumentScanResult) => {
    if (result.name) setName(result.name);
    if (result.gender) setGender(result.gender);
    if (result.dateOfBirth) setDateOfBirth(result.dateOfBirth);
    if (result.socialSecurityNumber) setSocialSecurityNumber(result.socialSecurityNumber);
  };

  const handleProfileScanResult = async (result: PatientDocumentScanResult) => {
    setError(null);
    setSuccess(null);

    const conflicts = detectPatientIdentityConflicts(
      profileBaseline || {
        name,
        gender,
        dateOfBirth,
        socialSecurityNumber,
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

    applyScannedProfile(result);
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    
    // Password validation
    if (newPassword.length < 6) {
      setError('新密码至少需要6个字符');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('新密码不匹配。');
      return;
    }
    
    try {
      const response = await fetchWithTimeout('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败。');
      }
      setSuccess('密码更新成功！');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword(''); // 修复：清理所有密码字段
    } catch (err) { setError(err instanceof Error ? err.message : '更新失败'); }
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/auth/signin' });
  };

  if (status === 'loading') return <div className="mobile-loading">加载中...</div>;
  if (status === 'unauthenticated') return <div className="mobile-access-denied">访问被拒绝。</div>;

  return (
    <div className="page-container">
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[2000]">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      
      {success && <div className="mobile-success">{success}</div>}

      <div className="mobile-section">
        <h2 className="mobile-section-title">账户信息</h2>
        <div className="mobile-form">
          <div className="mobile-form-group">
            <label className="mobile-form-label">用户名</label>
            <div className="mobile-form-input" style={{ display: 'flex', alignItems: 'center' }}>
              {username || name || ''}
            </div>
          </div>
          <div className="mobile-form-group">
            <label className="mobile-form-label">角色</label>
            <div className="mobile-form-input" style={{ display: 'flex', alignItems: 'center' }}>
              {session?.user?.role || ''}
            </div>
          </div>
          {session?.user?.role === 'PATIENT' ? (
            <div className="mobile-form-group">
              <label className="mobile-form-label">积分</label>
              <div className="mobile-form-input" style={{ display: 'flex', alignItems: 'center' }}>
                {scoreLoading ? '...' : (credibilityScore ?? '—')}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Profile Information */}
      <div className="mobile-section">
        <h2 className="mobile-section-title">我的资料</h2>
        <form onSubmit={handleProfileSubmit} className="mobile-form">
          <div className="mobile-form-group">
            <label className="mobile-form-label">用户名</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="mobile-form-input" />
          </div>
          <div className="mobile-form-group">
            <label className="mobile-form-label">姓名</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="mobile-form-input" />
          </div>
          <div className="mobile-form-group">
            <label className="mobile-form-label">联系电话</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="mobile-form-input" />
          </div>
          <div className="mobile-form-group">
            <label className="mobile-form-label">社保号 / 身份证号</label>
            <input type="text" value={socialSecurityNumber} readOnly className="mobile-form-input" />
            <p className="mt-2 text-xs text-gray-500">
              该号码只能通过社保卡/身份证扫描补录，不能手工修改。
            </p>
          </div>
          <div className="mobile-form-group">
            <label className="mobile-form-label">出生日期</label>
            <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} className="mobile-form-input" />
          </div>
          <div className="mobile-form-group">
            <label className="mobile-form-label">性别</label>
            <select value={gender} onChange={e => setGender(e.target.value)} className="mobile-form-select">
              <option value="">选择性别</option>
              <option value="Male">男</option>
              <option value="Female">女</option>
              <option value="Other">其他</option>
            </select>
          </div>
          {session?.user?.role === 'PATIENT' ? (
            <div className="mobile-form-group">
              <PatientDocumentScanner
                disabled={profileScannerBusy}
                onBusyChange={setProfileScannerBusy}
                onScanResult={handleProfileScanResult}
              />
            </div>
          ) : null}
          <button type="submit" className="mobile-submit-btn" disabled={profileScannerBusy}>保存资料</button>
        </form>
      </div>

      {/* Change Password */}
      <div className="mobile-section">
        <h2 className="mobile-section-title">修改密码</h2>
        <form onSubmit={handlePasswordSubmit} className="mobile-form">
           <div className="mobile-form-group">
            <label className="mobile-form-label">当前密码</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="mobile-form-input" required />
          </div>
          <div className="mobile-form-group">
            <label className="mobile-form-label">新密码</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mobile-form-input" required />
          </div>
          <div className="mobile-form-group">
            <label className="mobile-form-label">确认新密码</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mobile-form-input" required />
          </div>
          <button type="submit" className="mobile-submit-btn">更新密码</button>
        </form>
      </div>

      <div className="mobile-logout-section">
        <button 
          onClick={handleLogout} 
          className="mobile-logout-btn"
        >
          登出
        </button>
      </div>

      {pendingScanReview && (
        <div className="mobile-dialog-overlay">
          <div className="mobile-dialog">
            <div className="mobile-dialog-header">
              <h3 className="mobile-dialog-title">发现社保卡信息与当前资料不一致</h3>
            </div>
            <div className="mobile-dialog-content">
              <p className="mobile-dialog-message">
                如果继续覆盖，系统将以本次扫描出的姓名、性别、出生日期和社保号为准，更新当前账户资料。
              </p>
              <div className="mobile-dialog-appointment-info">
                {pendingScanReview.conflicts.map((item) => (
                  <div key={item.field} className="mobile-dialog-info-row" style={{ display: 'block' }}>
                    <div><strong>{item.label}</strong></div>
                    <div>当前：{item.currentValue}</div>
                    <div>扫描：{item.scannedValue}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mobile-dialog-actions">
              <button
                type="button"
                onClick={() => setPendingScanReview(null)}
                className="mobile-dialog-cancel-btn"
              >
                取消，保留原资料
              </button>
              <button
                type="button"
                onClick={() => {
                  applyScannedProfile(pendingScanReview.result);
                  setPendingScanReview(null);
                }}
                className="mobile-dialog-primary-btn"
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
