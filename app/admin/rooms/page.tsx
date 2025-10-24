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
  if (status === 'loading' || isLoading) return <div className="container mx-auto p-8 text-center">加载中...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="container mx-auto p-8 text-center text-red-600">{error || '访问被拒绝：您必须是管理员才能查看此页面。'}</div>;

  return (
    <div className="container mx-auto p-6 md:p-10">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-foreground">诊室管理</h1>
        <button onClick={() => openModal('add')} className="btn btn-primary text-lg">
          添加诊室
        </button>
      </div>

      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
      {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}

      <div className="bg-white p-6 rounded-2xl shadow-lg">
        <ul className="space-y-4">
          {rooms.length > 0 ? rooms.map((room) => (
            <li key={room.id} className="p-5 border rounded-xl shadow-sm flex justify-between items-center">
              <div>
                <p className="font-semibold text-xl">{room.name} ({room.bedCount} 床位)</p>
                <p className="text-lg text-gray-600">所属医生: {room.doctor.name}</p>
              </div>
              <div className="flex space-x-2">
                <button onClick={() => openModal('edit', room)} className="btn btn-secondary text-base">编辑</button>
                <button onClick={() => handleDelete(room.id)} className="btn bg-error text-white text-base">删除</button>
              </div>
            </li>
          )) : <p className="text-center text-2xl text-gray-500 py-10">未找到诊室。</p>}
        </ul>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-lg">
            <h2 className="text-3xl font-bold mb-6 capitalize">{modalMode === 'add' ? '添加诊室' : '编辑诊室'}</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="诊室名称" className="input-base text-lg" required />
            <input type="number" value={bedCount} onChange={e => setBedCount(parseInt(e.target.value, 10))} placeholder="床位数量" className="input-base text-lg" min="1" required />
            
            <div>
              <label htmlFor="doctor-select" className="block text-lg font-medium">指定所属医生</label>
              <select
                id="doctor-select"
                value={selectedDoctorId}
                onChange={e => setSelectedDoctorId(e.target.value)}
                className="input-base mt-2 text-lg"
                required
              >
                <option value="">-- 选择医生 --</option>
                {doctors.map(doctor => (
                  <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-4 pt-4">
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
              