'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface Appointment {
  id: string;
  time: string;
  patient: { name: string };
  status: string;
}

// --- Component ---
export default function DoctorAppointmentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Modal States ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [assignedBedId, setAssignedBedId] = useState('');

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') {
      setError('访问被拒绝');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;

    const fetchCheckedInAppointments = async () => {
      setIsLoading(true);
      try {
        const doctorId = session.user.id; // Assuming doctor's user ID is the doctorId
        const res = await fetch(`/api/appointments?doctorId=${doctorId}&status=CHECKED_IN&date=today`);
        if (!res.ok) throw new Error('获取已签到预约失败。');
        const data = await res.json();
        setAppointments(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchCheckedInAppointments();
  }, [status, session]);

  // --- Handlers ---
  const openConfirmationModal = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setAssignedBedId('');
    setIsModalOpen(true);
  };

  const handleConfirmAndAssignBed = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedAppointment || !assignedBedId) {
      setError('请输入床位号。');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/appointments/${selectedAppointment.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CONFIRM', bedId: parseInt(assignedBedId) }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '操作失败。');
      }

      setAppointments(prev => prev.filter(apt => apt.id !== selectedAppointment.id));
      setSuccess(`已为 ${selectedAppointment.patient.name} 确认并分配床位。`);
      setIsModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  // --- Render Logic ---
  if (status === 'loading' || isLoading) {
    return <div className="container mx-auto p-8 text-center">正在加载...</div>;
  }

  if (!session || session.user.role !== 'DOCTOR') {
    return <div className="container mx-auto p-8 text-center"><h1 className="text-2xl font-bold text-red-600">访问被拒绝</h1><p className="mt-2">{error || '您必须以医生身份登录才能查看此页面。'}</p></div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">预约确认</h1>
      <p className="text-lg text-gray-600 mb-8">此处显示所有今日已签到、等待您确认并分配床位的病人。</p>
      {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}
      {success && <div className="p-4 mb-6 text-lg text-white bg-success rounded-xl">{success}</div>}

      <div className="bg-white p-8 rounded-2xl shadow-lg">
        <div className="space-y-6">
          {appointments.length > 0 ? appointments.map(apt => (
            <div key={apt.id} className="p-5 border rounded-xl shadow-sm flex justify-between items-center bg-blue-50">
              <div>
                <p className="font-semibold text-xl">{apt.patient.name}</p>
                <p className="text-lg text-gray-600">预约时间: {apt.time}</p>
              </div>
              <button onClick={() => openConfirmationModal(apt)} className="btn btn-primary text-lg">确认并分配床位</button>
            </div>
          )) : (
            <div className="text-center py-20">
              <p className="text-2xl text-gray-500">当前没有已签到的病人。</p>
            </div>
          )}
        </div>
      </div>

      {isModalOpen && selectedAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-lg">
            <h2 className="text-3xl font-bold mb-6">确认签到并分配床位</h2>
            <form onSubmit={handleConfirmAndAssignBed}>
              <p className="text-lg mb-4">病人: <span className="font-semibold">{selectedAppointment.patient.name}</span></p>
              <p className="text-lg mb-6">时间: {selectedAppointment.time}</p>
              <div>
                <label htmlFor="bedId" className="block text-lg font-medium text-foreground">请输入床位号</label>
                <input id="bedId" type="number" value={assignedBedId} onChange={e => setAssignedBedId(e.target.value)} className="input-base mt-2 text-lg" required />
              </div>
              <div className="flex justify-end gap-4 mt-8">
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">取消</button>
                <button type="submit" className="btn btn-primary text-lg">确认分配</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}