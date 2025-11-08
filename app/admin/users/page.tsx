'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { pinyin } from 'pinyin-pro';
import './mobile.css';

// --- Interfaces ---


const genderMap: { [key: string]: string } = {
  Male: '男',
  Female: '女',
  Other: '其他',
};

const calculateAge = (dateOfBirth?: string) => {
  if (!dateOfBirth) return '';
  const birthDate = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  
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
    if (user?.dateOfBirth) {
      const d = new Date(user.dateOfBirth);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      setDateOfBirth(`${y}-${m}-${day}`);
    } else {
      setDateOfBirth('');
    }
    setGender(user?.gender || '');
    let defaultRole: 'PATIENT' | 'DOCTOR' | 'ADMIN' = 'PATIENT';
    if (activeTab === 'doctors') defaultRole = 'DOCTOR';
    if (activeTab === 'patients') defaultRole = 'PATIENT';
    if (activeTab === 'admins') defaultRole = 'ADMIN';
    setRole(user?.role || defaultRole);
    setCredibilityScore(user?.patientProfile?.credibilityScore || 15);
    setIsSuspended(user?.patientProfile?.isSuspended || false);
    setPassword(''); // Always clear password field
    setIsUsernameManuallyEdited(mode === 'edit'); // Allow editing username in add mode, but lock it in edit mode initially
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSubmitting) return;
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
    setIsSubmitting(true);

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
    } finally {
      setIsSubmitting(false);
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
  if (status === 'loading' || isLoading) return <div className="mobile-loading">加载中...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="mobile-access-denied">{error}</div>;

  return (
    <div className="page-container">
      <div className="mobile-header-section">
        <h1 className="mobile-header">用户管理</h1>
        <button onClick={() => openModal('add')} className="mobile-add-btn">
          添加用户
        </button>
      </div>

      {error && <div className="mobile-error">{error}</div>}
      {success && <div className="mobile-success">{success}</div>}

      <div className="mobile-content-section">
        {/* Tabs */}
        <div className="mobile-tabs-container">
          <nav className="mobile-tabs" aria-label="Tabs">
            <button onClick={() => setActiveTab('all')} className={`mobile-tab ${activeTab === 'all' ? 'mobile-tab-active' : 'mobile-tab-inactive'}`}>所有用户</button>
            <button onClick={() => setActiveTab('doctors')} className={`mobile-tab ${activeTab === 'doctors' ? 'mobile-tab-active' : 'mobile-tab-inactive'}`}>医生</button>
            <button onClick={() => setActiveTab('patients')} className={`mobile-tab ${activeTab === 'patients' ? 'mobile-tab-active' : 'mobile-tab-inactive'}`}>患者</button>
            <button onClick={() => setActiveTab('admins')} className={`mobile-tab ${activeTab === 'admins' ? 'mobile-tab-active' : 'mobile-tab-inactive'}`}>管理员</button>
          </nav>
        </div>

        <ul className="mobile-users-list">
          {filteredUsers.length > 0 ? filteredUsers.map((user) => (
            <li key={user.id} className="mobile-user-item">
              <div className="mobile-user-info">
                <p className="mobile-user-name">{user.username} <span className="mobile-user-role">({user.role})</span></p>
                <div className="mobile-user-details">
                  <p className="mobile-user-detail">姓名: {user.name}</p>
                  {user.phone && <p className="mobile-user-detail">电话: {user.phone}</p>}
                  {user.dateOfBirth && <p className="mobile-user-detail">年龄: {calculateAge(user.dateOfBirth)}</p>}
                  {user.gender && <p className="mobile-user-detail">性别: {genderMap[user.gender] || user.gender}</p>}
                  {user.patientProfile && <p className="mobile-user-detail">患者 (信誉分: {user.patientProfile.credibilityScore}, 是否暂停: {user.patientProfile.isSuspended ? '是' : '否'})</p>}
                </div>
              </div>
              <div className="mobile-user-actions">
                <button onClick={() => openModal('edit', user)} className="mobile-action-btn mobile-edit-btn">编辑</button>
                <button onClick={() => openModal('reset_password', user)} className="mobile-action-btn mobile-reset-btn">重置密码</button>
                <button onClick={() => handleDelete(user.id)} className="mobile-action-btn mobile-delete-btn">删除</button>
              </div>
            </li>
          )) : <div className="mobile-empty-state"><p className="mobile-empty-text">未找到该分类下的用户。</p></div>}
        </ul>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <h2 className="mobile-modal-title">{modalMode === 'add' ? '添加用户' : modalMode === 'edit' ? '编辑用户' : '重置密码'}</h2>
            <form onSubmit={handleSubmit} className="mobile-modal-form">
              <div className="mobile-form-group">
                <label className="mobile-form-label">姓名</label>
                <input type="text" value={name} onChange={(e) => {
                  setName(e.target.value);
                  if (modalMode === 'add') {
                    setIsUsernameManuallyEdited(false);
                  }
                }} placeholder="姓名" className="mobile-form-input" required />
              </div>
              
              <div className="mobile-form-group">
                <label className="mobile-form-label">用户名</label>
                <input type="text" value={username} onChange={(e) => { setUsername(e.target.value); setIsUsernameManuallyEdited(true); }} placeholder="用户名" className={`mobile-form-input ${modalMode === 'edit' ? 'mobile-form-input:disabled' : ''}`} required disabled={modalMode === 'edit'} />
              </div>
              
              <div className="mobile-form-group">
                <label className="mobile-form-label">电话（可选）</label>
                <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="电话（可选）" className="mobile-form-input" />
              </div>
              
              <div className="mobile-form-group">
                <label className="mobile-form-label">出生日期（可选）</label>
                <DatePicker
                  selected={dateOfBirth ? new Date(dateOfBirth) : null}
                  onChange={(date: Date) => {
                    if (!date) { setDateOfBirth(''); return; }
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    setDateOfBirth(`${y}-${m}-${day}`);
                  }}
                  placeholderText="选择出生日期（可选）"
                  className="mobile-form-input"
                  dateFormat="yyyy-MM-dd"
                  showYearDropdown
                  scrollableYearDropdown
                />
              </div>
              
              <div className="mobile-form-group">
                <label className="mobile-form-label">性别（可选）</label>
                <select value={gender} onChange={e => setGender(e.target.value)} className="mobile-form-select">
                  <option value="">选择性别（可选）</option>
                  <option value="Male">男</option>
                  <option value="Female">女</option>
                  <option value="Other">其他</option>
                </select>
              </div>
              
              <div className="mobile-form-group">
                <label className="mobile-form-label">角色</label>
                <select value={role} onChange={e => setRole(e.target.value as 'PATIENT' | 'DOCTOR' | 'ADMIN')} className="mobile-form-select">
                  <option value="PATIENT">患者</option>
                  <option value="DOCTOR">医生</option>
                  <option value="ADMIN">管理员</option>
                </select>
              </div>
              
              {modalMode === 'add' && (
                <div className="mobile-form-group">
                  <label className="mobile-form-label">初始密码</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="初始密码" className="mobile-form-input" required />
                </div>
              )}

              {/* Patient Specific Fields */}
              {selectedUser?.role === 'PATIENT' && modalMode === 'edit' && (
                <>
                  <div className="mobile-form-group">
                    <label className="mobile-form-label">信誉分</label>
                    <input type="number" value={credibilityScore} onChange={e => setCredibilityScore(parseInt(e.target.value))} className="mobile-form-input" />
                  </div>
                  <div className="mobile-checkbox-group">
                    <input type="checkbox" checked={isSuspended} onChange={e => setIsSuspended(e.target.checked)} id="isSuspended" className="mobile-checkbox" />
                    <label htmlFor="isSuspended" className="mobile-checkbox-label">是否暂停</label>
                  </div>
                </>
              )}

              <div className="mobile-modal-actions">
                <button type="button" onClick={closeModal} className="mobile-cancel-btn" disabled={isSubmitting}>取消</button>
                <button type="submit" className="mobile-save-btn" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
