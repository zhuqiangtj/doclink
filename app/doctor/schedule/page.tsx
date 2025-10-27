'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface Appointment {
  id: string;
  date: string;
  time: string;
  patient: { name: string };
  status: string;
}

// --- Component ---
export default function DoctorSchedulePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') setError('访问被拒绝');
  }, [status, session, router]);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;

    const fetchDoctorData = async () => {
      setIsLoading(true);
      try {
        const [userRes, appointmentsRes] = await Promise.all([
          fetch(`/api/user/${session.user.id}`),
          fetch(`/api/appointments?doctorId=${session.user.id}`)
        ]);

        if (!userRes.ok) throw new Error('获取医生资料失败。');
        if (!appointmentsRes.ok) throw new Error('获取预约失败。');

        const userData = await userRes.json();
        if (!userData.doctorProfile) throw new Error('未找到医生资料。');
        setDoctorProfile(userData.doctorProfile);
        setAppointments(await appointmentsRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchDoctorData();
  }, [status, session]);

  const handleMarkAsNoShow = async (appointmentId: string) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/no-show`, { method: 'POST' });
      if (!res.ok) throw new Error('标记爽约失败');
      const updatedAppointment = await res.json();
      setAppointments(prev => prev.map(apt => apt.id === appointmentId ? updatedAppointment : apt));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const getDisplayStatus = (apt: Appointment) => {
    if (apt.status === 'pending' && new Date() > new Date(`${apt.date}T${apt.time}`)) {
      return <span className="text-gray-500">已完成 (自动)</span>;
    }
    if (apt.status === 'NO_SHOW') return <span className="text-red-500">已爽约</span>;
    return <span className="text-green-500">待就诊</span>;
  };

  const dailyAppointments = appointments.filter(apt => new Date(apt.date).toDateString() === selectedDate.toDateString());

  if (status === 'loading' || isLoading || !doctorProfile) {
    return <div className="container mx-auto p-8 text-center">正在加载医生数据...</div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">预约日历 ({doctorProfile.name})</h1>
      {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="bg-white p-8 rounded-2xl shadow-lg">
            <DatePicker selected={selectedDate} onChange={(date: Date) => setSelectedDate(date)} inline />
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-white p-8 rounded-2xl shadow-lg">
            <h2 className="text-3xl font-bold mb-6">{selectedDate.toLocaleDateString()} 的预约</h2>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {dailyAppointments.length > 0 ? dailyAppointments.map(apt => (
                <div key={apt.id} className="p-4 border rounded-xl flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-xl">{apt.patient.name} - {apt.time}</p>
                    <p className="text-lg">状态: {getDisplayStatus(apt)}</p>
                  </div>
                  {new Date() > new Date(`${apt.date}T${apt.time}`) && apt.status !== 'NO_SHOW' && (
                    <button onClick={() => handleMarkAsNoShow(apt.id)} className="btn bg-yellow-500 text-white text-base">标记为爽约</button>
                  )}
                </div>
              )) : <p>当天没有预约。</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}