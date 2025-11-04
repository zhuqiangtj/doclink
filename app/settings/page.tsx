'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession, signOut } from 'next-auth/react';
import './mobile.css';

export default function SettingsPage() {
  const { data: session, status, update } = useSession();

  // Profile states
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  
  // Password states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI states
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    }
  }, [status, session]);

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
      const response = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, name, phone, dateOfBirth, gender }),
      });
      if (!response.ok) throw new Error('更新个人资料失败。');
      setSuccess('个人资料更新成功！');
      // Update session if needed
      await update();
    } catch (err) { setError(err instanceof Error ? err.message : '更新失败'); }
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
      const response = await fetch('/api/account/change-password', {
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
      <h1 className="mobile-header">设置</h1>
      {error && <div className="mobile-error">{error}</div>}
      {success && <div className="mobile-success">{success}</div>}

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
          <button type="submit" className="mobile-submit-btn">保存资料</button>
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
    </div>
  );
}