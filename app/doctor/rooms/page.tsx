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
  rooms: Room[];
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
      setError('Access Denied: You are not a doctor.');
    }
    if (status === 'authenticated' && session.user.role === 'DOCTOR') {
      const fetchDoctorData = async () => {
        setIsLoading(true);
        try {
          const userRes = await fetch(`/api/user/${session.user.id}`);
          if (!userRes.ok) throw new Error('Failed to fetch doctor profile.');
          const userData = await userRes.json();
          if (!userData.doctorProfile) throw new Error('Doctor profile not found for this user.');
          setDoctorProfile(userData.doctorProfile);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'An unknown error occurred');
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
      if (!response.ok) throw new Error('Failed to add room.');
      
      const newRoom = await response.json();
      setDoctorProfile(prev => prev ? { ...prev, rooms: [...prev.rooms, newRoom] } : null);
      setNewRoomName('');
      setNewRoomBedCount(1);
      setSuccess('Room added successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!doctorProfile) return;
    setError(null);
    setSuccess(null);

    if (window.confirm('Are you sure you want to delete this room? This action cannot be undone.')) {
      try {
        const response = await fetch(`/api/rooms?roomId=${roomId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete room.');
        
        setDoctorProfile(prev => prev ? { ...prev, rooms: prev.rooms.filter(r => r.id !== roomId) } : null);
        setSuccess('Room deleted successfully!');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
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
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <h1 className="text-3xl font-bold mb-6">我的诊室 ({doctorProfile.name})</h1>
        
        {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
        {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}
  
        <div className="p-4 border rounded-lg shadow-md bg-white mb-6">
          <h2 className="text-xl font-semibold mb-4">添加新诊室</h2>
          <form onSubmit={handleAddRoom} className="space-y-3">
            <input type="text" placeholder="诊室名称" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} className="block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 shadow-sm text-gray-900" required />
            <input type="number" placeholder="床位数量" value={newRoomBedCount} onChange={e => setNewRoomBedCount(parseInt(e.target.value, 10))} className="block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 shadow-sm text-gray-900" min="1" required />
            <button type="submit" className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700">添加诊室</button>
          </form>
        </div>
  
        <div className="p-4 border rounded-lg shadow-md bg-white">
          <h2 className="text-xl font-semibold mb-4">现有诊室</h2>
          <div className="space-y-2">
            {doctorProfile.rooms.length > 0 ? doctorProfile.rooms.map(room => (
              <div key={room.id} className="flex items-center justify-between p-2 border rounded-md">
                <span>{room.name} ({room.bedCount} 床位)</span>
                <button onClick={() => handleDeleteRoom(room.id)} className="text-red-500 hover:text-red-700 text-sm">删除</button>
              </div>
            )) : <p className="text-gray-500">尚未添加诊室。</p>}
          </div>
        </div>
      </div>
    );
  }
  