'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

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
    if (isLoading || status === 'loading') return <div className="container mx-auto p-8 text-center">加载中...</div>;
    if (!session || session.user.role !== 'DOCTOR' || !doctorProfile) {
      return (
        <div className="container mx-auto p-8 text-center">
          <h1 className="text-2xl font-bold text-red-600">访问被拒绝</h1>
          <p className="mt-2">{error || '您必须以医生身份登录才能查看此页面。'}</p>
        </div>
      );
    }
  
      return (
        <div className="container mx-auto p-6 md:p-10">
          <h1 className="text-4xl font-bold mb-8 text-foreground">我的诊室 ({doctorProfile.name})</h1>
          
          {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}
          {success && <div className="p-4 mb-6 text-lg text-white bg-success rounded-xl">{success}</div>}  
        <div className="p-8 bg-white rounded-2xl shadow-lg mb-10">
          <h2 className="text-2xl font-semibold mb-6">添加新诊室</h2>
          <form onSubmit={handleAddRoom} className="space-y-6">
            <input type="text" placeholder="诊室名称" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} className="input-base text-lg" required />
            <input type="number" placeholder="床位数量" value={newRoomBedCount} onChange={e => setNewRoomBedCount(parseInt(e.target.value, 10))} className="input-base text-lg" min="1" required />
            <button type="submit" className="w-full btn btn-primary text-lg">添加诊室</button>
          </form>
        </div>
  
        <div className="p-8 bg-white rounded-2xl shadow-lg">
          <h2 className="text-2xl font-semibold mb-6">现有诊室</h2>
          <div className="space-y-4">
            {doctorProfile.Room && doctorProfile.Room.length > 0 ? doctorProfile.Room.map(room => (
              <div key={room.id} className="flex items-center justify-between p-5 border rounded-xl shadow-sm">
                <span className="text-xl">{room.name} ({room.bedCount} 床位)</span>
                <button onClick={() => handleDeleteRoom(room.id)} className="btn bg-error text-white text-base">删除</button>
              </div>
            )) : <p className="text-center text-2xl text-gray-500 py-10">尚未添加诊室。</p>}
          </div>
        </div>
      </div>
    );
  }
  