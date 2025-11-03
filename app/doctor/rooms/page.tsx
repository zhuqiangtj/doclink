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

interface DoctorProfile {
  id: string;
  name: string;
  Room: Room[];
}

// --- Component ---
export default function DoctorRoomsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);

  // --- Form States ---
  const [roomName, setRoomName] = useState('');
  const [bedCount, setBedCount] = useState(1);

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  // --- Effects ---
  // Auth check and initial data load
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') {
      setError('访问被拒绝：您不是医生。');
    }
    if (status === 'authenticated' && session.user.role === 'DOCTOR') {
      const fetchDoctorData = async () => {
        setIsLoading(true);
        try {
          const userRes = await fetch(`/api/user/${session.user.id}`);
          if (!userRes.ok) throw new Error('获取医生资料失败。');
          const userData = await userRes.json();
          if (!userData.doctorProfile) throw new Error('未找到该用户的医生资料。');
          setDoctorProfile(userData.doctorProfile);
        } catch (err) {
          setError(err instanceof Error ? err.message : '发生未知错误');
        } finally {
          setIsLoading(false);
        }
      };
      fetchDoctorData();
    }
  }, [status, session, router]);

  // --- Modal Handlers ---
  const openAddModal = () => {
    setModalMode('add');
    setRoomName('');
    setBedCount(1);
    setSelectedRoom(null);
    setShowModal(true);
  };

  const openEditModal = (room: Room) => {
    setModalMode('edit');
    setRoomName(room.name);
    setBedCount(room.bedCount);
    setSelectedRoom(room);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedRoom(null);
    setRoomName('');
    setBedCount(1);
  };

  // --- Handlers ---
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!roomName || bedCount < 1 || !doctorProfile) return;
    setError(null);
    setSuccess(null);

    try {
      if (modalMode === 'add') {
        const response = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: roomName,
            bedCount: bedCount,
            doctorId: doctorProfile.id,
          }),
        });
        if (!response.ok) throw new Error('添加诊室失败。');
        
        const newRoom = await response.json();
        setDoctorProfile(prev => prev ? { ...prev, Room: [...prev.Room, newRoom] } : null);
        setSuccess('诊室添加成功！');
      } else if (modalMode === 'edit' && selectedRoom) {
        const response = await fetch(`/api/rooms?roomId=${selectedRoom.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: roomName,
            // 編輯時不傳送 bedCount，保持原有床位數量
          }),
        });
        if (!response.ok) throw new Error('更新诊室失败。');
        
        const updatedRoom = await response.json();
        setDoctorProfile(prev => prev ? {
          ...prev,
          Room: prev.Room.map(r => r.id === selectedRoom.id ? updatedRoom : r)
        } : null);
        setSuccess('诊室更新成功！');
      }
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!doctorProfile) return;
    setError(null);
    setSuccess(null);

    if (window.confirm('您确定要删除此诊室吗？此操作无法撤销。')) {
      try {
        const response = await fetch(`/api/rooms?roomId=${roomId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('删除诊室失败。');
        
        setDoctorProfile(prev => prev ? { ...prev, Room: prev.Room.filter(r => r.id !== roomId) } : null);
        setSuccess('诊室删除成功！');
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    }
  };
  // --- Render Logic ---
  if (isLoading || status === 'loading') return <div className="mobile-loading">加载中...</div>;
  if (!session || session.user.role !== 'DOCTOR' || !doctorProfile) {
    return (
      <div className="mobile-access-denied">
        <h1 className="mobile-access-denied-title">访问被拒绝</h1>
        <p className="mobile-access-denied-text">{error || '您必须以医生身份登录才能查看此页面。'}</p>
      </div>
    );
  }

  return (
    <div className="page-container space-y-4">
      <div className="mobile-header">
        <h1 className="text-2xl md:text-4xl font-bold text-foreground">
          我的诊室
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          {doctorProfile.name}
        </p>
      </div>
      
      <div className="mobile-card space-y-4">
        <button
          onClick={openAddModal}
          className="mobile-btn mobile-btn-primary w-full flex items-center justify-center space-x-2"
        >
          <span>添加诊室</span>
        </button>
      </div>

      {error && <div className="mobile-error">{error}</div>}
      {success && <div className="mobile-success">{success}</div>}

      <div className="mobile-card">
        <div className="mobile-rooms-list">
          {doctorProfile.Room && doctorProfile.Room.length > 0 ? doctorProfile.Room.map(room => (
            <div key={room.id} className="mobile-room-item">
              <div className="mobile-room-info">
                <h3 className="mobile-room-name">{room.name}</h3>
                <p className="mobile-room-details">{room.bedCount} 床位</p>
              </div>
              <div className="mobile-room-actions">
                <button onClick={() => openEditModal(room)} className="mobile-action-btn mobile-edit-btn">
                  编辑
                </button>
                <button onClick={() => handleDeleteRoom(room.id)} className="mobile-action-btn mobile-delete-btn">
                  删除
                </button>
              </div>
            </div>
          )) : (
            <div className="mobile-empty-state">
              <p className="mobile-empty-text">尚未添加诊室。</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="mobile-modal-overlay" onClick={closeModal}>
          <div className="mobile-modal" onClick={e => e.stopPropagation()}>
            <h2 className="mobile-modal-title">
              {modalMode === 'add' ? '添加诊室' : '编辑诊室'}
            </h2>
            <form onSubmit={handleSubmit} className="mobile-modal-form">
              <div className="mobile-form-group">
                <label className="mobile-form-label">诊室名称</label>
                <input 
                  type="text" 
                  value={roomName} 
                  onChange={e => setRoomName(e.target.value)} 
                  placeholder="例如：一号诊室" 
                  className="mobile-form-input" 
                  required 
                />
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
            </form>
            <div className="mobile-modal-actions">
              <button type="button" onClick={closeModal} className="mobile-cancel-btn">
                取消
              </button>
              <button type="submit" onClick={handleSubmit} className="mobile-save-btn">
                {modalMode === 'add' ? '添加' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
  