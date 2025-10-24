'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import pinyin from 'pinyin';

// --- Interfaces ---
interface User {
  id: string;
  username: string;
  name: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  patientProfile?: { id: string; credibilityScore: number; isSuspended: boolean; };
  doctorProfile?: { id: string; };
}

interface Room {
  id: string;
  name: string;
}

// --- Component ---
export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [users, setUsers] = useState<User[]>([]);
  
  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'doctors' | 'patients' | 'admins'>('all');
  
  // --- Modal States ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit' | 'reset_password'>('add');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // --- Form States ---
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'PATIENT' | 'DOCTOR' | 'ADMIN'>('PATIENT');
  const [credibilityScore, setCredibilityScore] = useState(15);
  const [isSuspended, setIsSuspended] = useState(false);
  const [isUsernameManuallyEdited, setIsUsernameManuallyEdited] = useState(false);

  // --- Effects ---
  // Auth check
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'ADMIN') {
      setError('访问被拒绝：您必须是管理员才能查看此页面。');
    }
  }, [status, session, router]);

  // Initial data fetch
  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'ADMIN') return;
    
    const fetchUsersAndRooms = async () => {
      setIsLoading(true);
      try {
        const usersRes = await fetch('/api/users');

        if (!usersRes.ok) throw new Error('获取用户列表失败。');

        setUsers(await usersRes.json());

      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchUsersAndRooms();
  }, [status, session]);

  useEffect(() => {
    if (name && !isUsernameManuallyEdited) {
      const pinyinName = pinyin(name, { style: pinyin.STYLE_NORMAL }).flat().join('');
      setUsername(pinyinName);
    }
  }, [name, isUsernameManuallyEdited]);

  // --- Modal Logic ---
  const openModal = (mode: 'add' | 'edit' | 'reset_password', user: User | null = null) => {
    setModalMode(mode);
    setSelectedUser(user);
    setUsername(user?.username || '');
    setName(user?.name || '');
    setPhone(user?.phone || '');
    setDateOfBirth(user?.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split('T')[0] : '');
    setGender(user?.gender || '');
    setRole(user?.role || 'PATIENT');
    setCredibilityScore(user?.patientProfile?.credibilityScore || 15);
    setIsSuspended(user?.patientProfile?.isSuspended || false);
    setPassword(''); // Always clear password field
    setIsUsernameManuallyEdited(mode === 'edit'); // Allow editing username in add mode, but lock it in edit mode initially
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedUser(null);
    setError(null);
    setSuccess(null);
  };

  // --- Handlers ---
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const url = modalMode === 'add' ? '/api/users' : `/api/users?userId=${selectedUser?.id}`;
    const method = modalMode === 'add' ? 'POST' : 'PUT';

    const body: Record<string, unknown> = {};
    if (modalMode === 'add') {
      Object.assign(body, { username, name, phone, dateOfBirth, gender, password, role });
    } else if (modalMode === 'edit') {
      Object.assign(body, { username, name, phone, dateOfBirth, gender, role, credibilityScore, isSuspended });
    } else if (modalMode === 'reset_password') {
      Object.assign(body, { password: '123456' }); // Default password for reset
    }

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '操作失败。');
      }

      const result = await response.json();

      if (modalMode === 'add') {
        setUsers(prev => [...prev, result]);
      } else {
        setUsers(prev => prev.map(u => u.id === result.id ? result : u));
      }
      
      setSuccess(`用户 ${modalMode === 'add' ? '添加' : '更新'} 成功！`);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  const handleDelete = async (userId: string) => {
    if (window.confirm('您确定要删除此用户吗？这将删除所有关联的个人资料和数据。')) {
      try {
        const response = await fetch(`/api/users?userId=${userId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('删除用户失败。');
        setUsers(prev => prev.filter(u => u.id !== userId));
        setSuccess('用户删除成功。');
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    }
  };

  // --- Filtering Logic ---
  const filteredUsers = users.filter(user => {
    if (activeTab === 'all') return true;
    // This handles the plural vs. singular issue (e.g., activeTab 'doctors' vs. user.role 'DOCTOR')
    return user.role.toLowerCase().startsWith(activeTab.slice(0, -1));
  });

  // --- Render Logic ---
  if (status === 'loading' || isLoading) return <div className="container mx-auto p-8 text-center">加载中...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="container mx-auto p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="container mx-auto p-6 md:p-10">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-foreground">用户管理</h1>
        <button onClick={() => openModal('add')} className="btn btn-primary text-lg">
          添加用户
        </button>
      </div>

      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
      {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}

      <div className="bg-white p-6 rounded-2xl shadow-lg">
        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button onClick={() => setActiveTab('all')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'all' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>所有用户</button>
            <button onClick={() => setActiveTab('doctors')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'doctors' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>医生</button>
            <button onClick={() => setActiveTab('patients')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'patients' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>患者</button>
            <button onClick={() => setActiveTab('admins')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'admins' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>管理员</button>
          </nav>
        </div>

        <ul className="space-y-4">
          {filteredUsers.length > 0 ? filteredUsers.map((user) => (
            <li key={user.id} className="p-5 border rounded-xl shadow-sm flex justify-between items-center">
              <div>
                <p className="font-semibold text-xl">{user.username} <span className="text-base text-gray-500">({user.role})</span></p>
                <p className="text-lg text-gray-600">姓名: {user.name}</p>
                {user.phone && <p className="text-lg text-gray-600">电话: {user.phone}</p>}
                {user.dateOfBirth && <p className="text-lg text-gray-600">出生日期: {new Date(user.dateOfBirth).toLocaleDateString()}</p>}
                {user.gender && <p className="text-lg text-gray-600">性别: {user.gender}</p>}
                {user.patientProfile && <p className="text-lg text-gray-600">患者 (信誉分: {user.patientProfile.credibilityScore}, 是否暂停: {user.patientProfile.isSuspended ? '是' : '否'})</p>}
              </div>
              <div className="flex flex-col space-y-2">
                <button onClick={() => openModal('edit', user)} className="btn btn-primary text-base">编辑</button>
                <button onClick={() => openModal('reset_password', user)} className="btn btn-secondary text-base">重置密码</button>
                <button onClick={() => handleDelete(user.id)} className="btn bg-error text-white text-base">删除</button>
              </div>
            </li>
          )) : <p className="text-center text-2xl text-gray-500 py-10">未找到该分类下的用户。</p>}
        </ul>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-lg">
            <h2 className="text-3xl font-bold mb-6 capitalize">{modalMode === 'add' ? '添加用户' : modalMode === 'edit' ? '编辑用户' : '重置密码'}</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              <input type="text" value={name} onChange={(e) => {
                setName(e.target.value);
                if (modalMode === 'add') {
                  setIsUsernameManuallyEdited(false);
                }
              }} placeholder="姓名" className="input-base text-lg" required />
              <input type="text" value={username} onChange={(e) => { setUsername(e.target.value); setIsUsernameManuallyEdited(true); }} placeholder="用户名" className={`input-base text-lg ${modalMode === 'edit' ? 'bg-gray-100' : ''}`} required disabled={modalMode === 'edit'} />
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="电话（可选）" className="input-base text-lg" />
                            <DatePicker
                selected={dateOfBirth ? new Date(dateOfBirth) : null}
                onChange={(date: Date) => setDateOfBirth(date.toISOString().split('T')[0])}
                placeholderText="出生日期（可选）"
                className="input-base text-lg"
                dateFormat="yyyy-MM-dd"
                showYearDropdown
                scrollableYearDropdown
              />
              <select value={gender} onChange={e => setGender(e.target.value)} className="input-base text-lg">
                <option value="">选择性别（可选）</option>
                <option value="Male">男</option>
                <option value="Female">女</option>
                <option value="Other">其他</option>
              </select>
              <select value={role} onChange={e => setRole(e.target.value as 'PATIENT' | 'DOCTOR' | 'ADMIN')} className="input-base text-lg">
                <option value="PATIENT">患者</option>
                <option value="DOCTOR">医生</option>
                <option value="ADMIN">管理员</option>
              </select>
              {modalMode === 'add' && (
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="初始密码" className="input-base text-lg" required />
              )}

              {/* Patient Specific Fields */}
              {selectedUser?.role === 'PATIENT' && modalMode === 'edit' && (
                <>
                  <div>
                    <label className="block text-lg font-medium">信誉分</label>
                    <input type="number" value={credibilityScore} onChange={e => setCredibilityScore(parseInt(e.target.value))} className="input-base mt-2" />
                  </div>
                  <div className="flex items-center mt-4">
                    <input type="checkbox" checked={isSuspended} onChange={e => setIsSuspended(e.target.checked)} id="isSuspended" className="h-5 w-5 text-primary border-gray-300 rounded" />
                    <label htmlFor="isSuspended" className="ml-3 block text-lg text-foreground">是否暂停</label>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-4 mt-8">
                <button type="button" onClick={closeModal} className="btn bg-gray-200 text-gray-800 text-lg">取消</button>
                <button type="submit" className="btn btn-primary text-lg">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
