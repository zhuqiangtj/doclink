'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';

export default function SettingsPage() {
  const { data: session, status, update } = useSession();

  // Profile states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState(''); // New: username state
  
  // Password states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI states
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated') {
      // @ts-expect-error: session.user might not have 'name' or 'phone' directly, as they are on profile objects
      setName(session.user.name || '');
      // @ts-expect-error: session.user might not have 'name' or 'phone' directly, as they are on profile objects
      setPhone(session.user.phone || '');
      setUsername(session.user.username || ''); // Initialize username
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
        body: JSON.stringify({ name, phone, username }), // Include username in body
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

  if (status === 'loading') return <div>Loading...</div>;
  if (status === 'unauthenticated') return <div>Access Denied.</div>;

  return (
    <div className="container mx-auto max-w-xl p-4">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>
      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
      {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}

      {/* Profile Information */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-semibold mb-4">My Profile</h2>
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300" />
          </div>
          <div>
            <label className="block text-sm font-medium">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300" />
          </div>
          <button type="submit" className="w-full py-2 px-4 bg-blue-600 text-white rounded-md">Save Profile</button>
        </form>
      </div>

      {/* Change Password */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">Change Password</h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
           <div>
            <label className="block text-sm font-medium">Current Password</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300" required />
          </div>
          <div>
            <label className="block text-sm font-medium">New Password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300" required />
          </div>
          <div>
            <label className="block text-sm font-medium">Confirm New Password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300" required />
          </div>
          <button type="submit" className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md">Update Password</button>
        </form>
      </div>
    </div>
  );
}
