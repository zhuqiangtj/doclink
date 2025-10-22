'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';

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
      setDateOfBirth(session.user.dateOfBirth ? new Date(session.user.dateOfBirth).toISOString().split('T')[0] : '');
      setGender(session.user.gender || '');
    }
  }, [status, session]);

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, name, phone, dateOfBirth, gender }),
      });
      if (!response.ok) throw new Error('Failed to update profile.');
      setSuccess('Profile updated successfully!');
      // Update session if needed
      await update();
    } catch (err) { setError(err instanceof Error ? err.message : 'Update failed'); }
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    try {
      const response = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Update failed.');
      }
      setSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Update failed'); }
  };

  if (status === 'loading') return <div className="container mx-auto p-8 text-center">Loading...</div>;
  if (status === 'unauthenticated') return <div className="container mx-auto p-8 text-center">Access Denied.</div>;

  return (
    <div className="container mx-auto max-w-xl p-4">
      <h1 className="text-3xl font-bold mb-6">设置</h1>
      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
      {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}

      {/* Profile Information */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-semibold mb-4">我的资料</h2>
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium">用户名</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-medium">姓名</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-medium">联系电话</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-medium">出生日期</label>
            <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-medium">性别</label>
            <select value={gender} onChange={e => setGender(e.target.value)} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900">
              <option value="">选择性别</option>
              <option value="Male">男</option>
              <option value="Female">女</option>
              <option value="Other">其他</option>
            </select>
          </div>
          <button type="submit" className="w-full py-2 px-4 bg-blue-600 text-white rounded-md">保存资料</button>
        </form>
      </div>

      {/* Change Password */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">修改密码</h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
           <div>
            <label className="block text-sm font-medium">当前密码</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" required />
          </div>
          <div>
            <label className="block text-sm font-medium">新密码</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" required />
          </div>
          <div>
            <label className="block text-sm font-medium">确认新密码</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" required />
          </div>
          <button type="submit" className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md">更新密码</button>
        </form>
      </div>
    </div>
  );
}