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
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomBedCount, setNewRoomBedCount] = useState(1);

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
          
            // --- Handlers ---
            const handleAddRoom = async (e: FormEvent) => {
              e.preventDefault();
              if (!newRoomName || newRoomBedCount < 1 || !doctorProfile) return;
              setError(null);
              setSuccess(null);
          
              try {
                const response = await fetch('/api/rooms', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: newRoomName,
                    bedCount: newRoomBedCount,
                    doctorId: doctorProfile.id, // Explicitly send doctorId
                  }),
                });
                if (!response.ok) throw new Error('添加诊室失败。');
                
                const newRoom = await response.json();
                setDoctorProfile(prev => prev ? { ...prev, Room: [...prev.Room, newRoom] } : null);
                setNewRoomName('');
                setNewRoomBedCount(1);
                setSuccess('诊室添加成功！');
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
        <div className="page-container">
          <h1 className="mobile-header">我的诊室 ({doctorProfile.name})</h1>
          
          {error && <div className="mobile-error">{error}</div>}
          {success && <div className="mobile-success">{success}</div>}  
        <div className="mobile-form-section">
          <h2 className="mobile-form-title">添加新诊室</h2>
          <form onSubmit={handleAddRoom} className="mobile-form">
            <div className="mobile-form-group">
              <label htmlFor="roomName" className="mobile-form-label">诊室名称</label>
              <input id="roomName" type="text" placeholder="例如：一号诊室" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} className="mobile-form-input" required />
            </div>
            <div className="mobile-form-group">
              <label htmlFor="bedCount" className="mobile-form-label">床位数量</label>
              <input id="bedCount" type="number" placeholder="例如：5" value={newRoomBedCount} onChange={e => setNewRoomBedCount(parseInt(e.target.value, 10))} className="mobile-form-input" min="1" required />
            </div>
            <button type="submit" className="mobile-submit-btn">添加诊室</button>
          </form>
        </div>
  
        <div className="mobile-rooms-section">
          <h2 className="mobile-rooms-title">现有诊室</h2>
          <div className="mobile-rooms-list">
            {doctorProfile.Room && doctorProfile.Room.length > 0 ? doctorProfile.Room.map(room => (
              <div key={room.id} className="mobile-room-item">
                <span className="mobile-room-info">{room.name} ({room.bedCount} 床位)</span>
                <button onClick={() => handleDeleteRoom(room.id)} className="mobile-delete-btn">删除</button>
              </div>
            )) : (
              <div className="mobile-empty-state">
                <p className="mobile-empty-text">尚未添加诊室。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  