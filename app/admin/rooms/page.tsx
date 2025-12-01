'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import './mobile.css';

// --- Interfaces ---
interface Room {
  id: string;
  name: string;
  bedCount: number;
  doctorId: string;
  doctor: { id: string; name: string };
}

interface Doctor {
  id: string;
  name: string;
}

interface UserWithDoctorProfile {
  id: string;
  email: string;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  doctorProfile?: { id: string; name: string; };
}

// --- Component ---
export default function AdminRoomsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [rooms, setRooms] = useState<Room[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]); // All doctors for selection
  
  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // --- Modal States ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  // --- Form States ---
  const [name, setName] = useState('');
  const [bedCount, setBedCount] = useState(1);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(''); // Single doctor ID

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
    
    const fetchRoomsAndDoctors = async () => {
      setIsLoading(true);
      try {
        const [roomsRes, usersRes] = await Promise.all([
          fetch('/api/rooms'), // Admin gets all rooms
          fetch('/api/users?role=DOCTOR'), // Admin gets all doctors
        ]);

        if (!roomsRes.ok) throw new Error('获取诊室列表失败。');
        if (!usersRes.ok) throw new Error('获取医生列表失败。');

        setRooms(await roomsRes.json());
        // Filter out only doctor profiles from users API response
        const doctorUsers: UserWithDoctorProfile[] = await usersRes.json();
        setDoctors(doctorUsers.filter(user => user.role === 'DOCTOR' && user.doctorProfile).map(user => user.doctorProfile as Doctor));

      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchRoomsAndDoctors();
  }, [status, session]);

  useEffect(() => {
    if (!overlayText) return;
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  useEffect(() => {
    if (error) setOverlayText(error);
  }, [error]);

  // --- Modal Logic ---
  const openModal = (mode: 'add' | 'edit', room: Room | null = null) => {
    setModalMode(mode);
    setSelectedRoom(room);
    setName(room?.name || '');
    setBedCount(room?.bedCount || 1);
    setSelectedDoctorId(room?.doctorId || ''); // Set single doctor ID
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setSelectedRoom(null);
    setError(null);
    setSuccess(null);
  };

  // --- Handlers ---
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    if (!selectedDoctorId) {
      setError('请为诊室选择一位医生。');
      return;
    }

    const url = modalMode === 'add' ? '/api/rooms' : `/api/rooms?roomId=${selectedRoom?.id}`;
    const method = modalMode === 'add' ? 'POST' : 'PUT';

    const body = { name, bedCount, doctorId: selectedDoctorId }; // Send single doctorId

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

      // Refresh room list after operation
      const roomsRes = await fetch('/api/rooms');
      setRooms(await roomsRes.json());
      
      setSuccess(`诊室 ${modalMode === 'add' ? '添加' : '更新'} 成功！`);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (roomId: string) => {
    if (window.confirm('您确定要删除此诊室吗？此操作无法撤销。')) {
      try {
        const response = await fetch(`/api/rooms?roomId=${roomId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('删除诊室失败。');
        setRooms(prev => prev.filter(r => r.id !== roomId));
        setSuccess('诊室删除成功！');
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    }
  };

  // --- Render Logic ---
  if (status === 'loading' || isLoading) return <div className="mobile-loading">加载中...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="mobile-access-denied">{error || '访问被拒绝：您必须是管理员才能查看此页面。'}</div>;

  return (
    <div className="page-container">
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[2000]">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      <div className="mobile-header-section">
        <h1 className="mobile-header">诊室管理</h1>
        <button onClick={() => openModal('add')} className="mobile-add-btn">
          添加诊室
        </button>
      </div>

      
      {success && <div className="mobile-success">{success}</div>}

      <div className="mobile-content-section">
        <ul className="mobile-rooms-list">
          {rooms.length > 0 ? rooms.map((room) => (
            <li key={room.id} className="mobile-room-item">
              <div className="mobile-room-info">
                <p className="mobile-room-name">{room.name} ({room.bedCount} 床位)</p>
                <div className="mobile-room-details">
                  <p className="mobile-room-detail">所属医生: {room.doctor.name}</p>
                </div>
              </div>
              <div className="mobile-room-actions">
                <button onClick={() => openModal('edit', room)} className="mobile-action-btn mobile-edit-btn">编辑</button>
                <button onClick={() => handleDelete(room.id)} className="mobile-action-btn mobile-delete-btn">删除</button>
              </div>
            </li>
          )) : <div className="mobile-empty-state"><p className="mobile-empty-text">未找到诊室。</p></div>}
        </ul>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <h2 className="mobile-modal-title">{modalMode === 'add' ? '添加诊室' : '编辑诊室'}</h2>
            <form onSubmit={handleSubmit} className="mobile-modal-form">
              <div className="mobile-form-group">
                <label className="mobile-form-label">诊室名称</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="诊室名称" className="mobile-form-input" required />
              </div>
              
              <div className="mobile-form-group">
                <label className="mobile-form-label">床位数量</label>
                <input 
                  type="number" 
                  value={bedCount} 
                  onChange={e => setBedCount(parseInt(e.target.value, 10))} 
                  placeholder="床位数量" 
                  className={`mobile-form-input ${modalMode === 'edit' ? 'mobile-form-input-disabled' : ''}`}
                  min="1" 
                  required 
                  disabled={modalMode === 'edit'}
                  readOnly={modalMode === 'edit'}
                />
                {modalMode === 'edit' && (
                  <p className="mobile-form-help-text">編輯時無法修改床位數量</p>
                )}
              </div>
              
              <div className="mobile-form-group">
                <label htmlFor="doctor-select" className="mobile-form-label">指定所属医生</label>
                <select
                  id="doctor-select"
                  value={selectedDoctorId}
                  onChange={e => setSelectedDoctorId(e.target.value)}
                  className="mobile-form-select"
                  required
                >
                  <option value="">-- 选择医生 --</option>
                  {doctors.map(doctor => (
                    <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
                  ))}
                </select>
              </div>

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
              
