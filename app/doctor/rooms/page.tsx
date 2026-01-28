'use client';

import { useState, useEffect, FormEvent, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { fetchWithTimeout } from '../../../utils/network';
import './mobile.css';

// --- Interfaces ---
interface Room {
  id: string;
  name: string;
  bedCount: number;
  isPrivate: boolean;
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
  const [isPrivate, setIsPrivate] = useState(false);

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const roomsSnapshotRef = useRef<Map<string, string>>(new Map());

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
          const userRes = await fetchWithTimeout(`/api/user/${session.user.id}`);
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

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!doctorProfile?.id) return;
    try {
      const es = new EventSource(`/api/realtime/subscribe?kind=doctor&id=${doctorProfile.id}`);
      es.onmessage = async (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          const type = evt?.type as string | undefined;
          switch (type) {
            case 'ROOM_CREATED':
            case 'ROOM_UPDATED':
            case 'ROOM_DELETED':
            case 'DOCTOR_SCHEDULE_UPDATED':
              {
                const res = await fetchWithTimeout('/api/rooms', { cache: 'no-store' });
                if (res.ok) {
                  const nextRooms: Room[] = await res.json();
                  setDoctorProfile((prev) => prev ? { ...prev, Room: nextRooms } : prev);
                  setOverlayText('已自动更新');
                }
              }
              break;
            default:
              break;
          }
        } catch {}
      };
      es.onerror = () => {};
      return () => es.close();
    } catch {}
  }, [status, doctorProfile?.id]);

  useEffect(() => {
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  useEffect(() => {
    if (error) setOverlayText(error);
  }, [error]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const res = await fetchWithTimeout('/api/rooms', { cache: 'no-store' });
        if (!res.ok) return;
        const rooms: Room[] = await res.json();
        const snap = new Map<string, string>();
        rooms.forEach(r => { snap.set(r.id, `${r.name}|${r.bedCount}|${r.isPrivate}`); });
        let changed = false;
        const prev = roomsSnapshotRef.current;
        if (prev.size !== snap.size) changed = true;
        if (!changed) {
          for (const [id, val] of snap.entries()) { if (prev.get(id) !== val) { changed = true; break; } }
        }
        roomsSnapshotRef.current = snap;
        if (changed) {
          setDoctorProfile(prev => prev ? { ...prev, Room: rooms } : prev);
          setOverlayText('已自动更新');
        }
      } catch {}
    };
    timer = setInterval(run, 60000);
    return () => { if (timer) clearInterval(timer); };
  }, [status]);

  // --- Modal Handlers ---
  const openAddModal = () => {
    setModalMode('add');
    setRoomName('');
    setBedCount(1);
    setIsPrivate(false);
    setSelectedRoom(null);
    setShowModal(true);
  };

  const openEditModal = (room: Room) => {
    setModalMode('edit');
    setRoomName(room.name);
    setBedCount(room.bedCount);
    setIsPrivate(room.isPrivate);
    setSelectedRoom(room);
    setShowModal(true);
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setShowModal(false);
    setSelectedRoom(null);
    setRoomName('');
    setBedCount(1);
    setIsPrivate(false);
  };

  // --- Handlers ---
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!roomName || bedCount < 1 || !doctorProfile) return;
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      if (modalMode === 'add') {
        const response = await fetchWithTimeout('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: roomName,
            bedCount: bedCount,
            isPrivate: isPrivate,
            doctorId: doctorProfile.id,
          }),
        });
        if (!response.ok) throw new Error('添加诊室失败。');
        
        const newRoom = await response.json();
        setDoctorProfile(prev => prev ? { ...prev, Room: [...prev.Room, newRoom] } : null);
        setSuccess('诊室添加成功！');
      } else if (modalMode === 'edit' && selectedRoom) {
        const response = await fetchWithTimeout(`/api/rooms?roomId=${selectedRoom.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: roomName,
            isPrivate: isPrivate,
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!doctorProfile) return;
    setError(null);
    setSuccess(null);

    if (window.confirm('您确定要删除此诊室吗？此操作无法撤销。')) {
      try {
        const response = await fetchWithTimeout(`/api/rooms?roomId=${roomId}`, { method: 'DELETE' });
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
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      
      <div className="mobile-card space-y-4">
        <button
          onClick={openAddModal}
          className="mobile-btn mobile-btn-primary w-full flex items-center justify-center space-x-2"
        >
          <span>添加诊室</span>
        </button>
      </div>

      
      {success && <div className="mobile-success">{success}</div>}

      <div className="mobile-card">
        <div className="mobile-rooms-list">
          {doctorProfile.Room && doctorProfile.Room.length > 0 ? doctorProfile.Room.map(room => (
            <div key={room.id} className="mobile-room-item">
              <div className="mobile-room-info">
                <h3 className="mobile-room-name">
                  {room.name}
                  {room.isPrivate && <span className="text-xs text-red-500 ml-2 font-normal">(私有)</span>}
                </h3>
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
              <div className="mobile-form-group flex flex-row items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  id="isPrivate"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isPrivate" className="mobile-form-label mb-0 cursor-pointer select-none">
                  设为私有诊室
                </label>
              </div>
              {isPrivate && (
                <p className="text-xs text-gray-500 italic mt-1">
                  私有诊室不会在病人端首页显示，只能由医生进行预约。
                </p>
              )}
            </form>
            <div className="mobile-modal-actions">
              <button type="button" onClick={closeModal} className="mobile-cancel-btn" disabled={isSubmitting}>
                取消
              </button>
              <button type="submit" onClick={handleSubmit} className="mobile-save-btn" disabled={isSubmitting}>
                {isSubmitting ? '处理中…' : (modalMode === 'add' ? '添加' : '保存')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
  
