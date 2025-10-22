'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface Patient {
  id: string;
  userId: string;
  username: string;
  name: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
}

interface ScheduleTimeSlot {
  time: string;
  total: number;
  booked: number;
}

interface ScheduleApiResponse {
  id: string;
  date: string;
  roomId: string;
  room: { name: string };
  timeSlots: ScheduleTimeSlot[];
}

interface Schedule {
  id: string;
  date: string;
  roomId: string;
  roomName: string;
  timeSlots: ScheduleTimeSlot[];
}

interface DoctorProfile {
  id: string;
  name: string;
}

// --- Component ---
export default function BookAppointmentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [searchedPatients, setSearchedPatients] = useState<Patient[]>([]);

  // --- Form States ---
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [selectedTime, setSelectedTime] = useState('');

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Effects ---
  // Auth check and initial data load
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') {
      setError('Access Denied.');
    }
    if (status === 'authenticated' && session.user.role === 'DOCTOR') {
      const fetchData = async () => {
        setIsLoading(true);
        try {
          const userRes = await fetch(`/api/user/${session.user.id}`);
          const userData = await userRes.json();
          if (!userData.doctorProfile) throw new Error('Doctor profile not found.');
          setDoctorProfile(userData.doctorProfile);

          const schedulesRes = await fetch(`/api/schedules`); // Fetches own schedules
          const schedulesData: ScheduleApiResponse[] = await schedulesRes.json();
          const formattedSchedules = schedulesData.map(s => ({ ...s, roomName: s.room.name }));
          setSchedules(formattedSchedules);

        } catch (err) {
          setError(err instanceof Error ? err.message : 'An unknown error occurred');
        } finally {
          setIsLoading(false);
        }
      };
      fetchData();
    }
  }, [status, session, router]);

  // --- Handlers ---
  const handlePatientSearch = async () => {
    if (!patientSearch) return;
    try {
      const res = await fetch(`/api/patients?search=${patientSearch}`);
      const data: Patient[] = await res.json();
      setSearchedPatients(data);
    } catch (err) {
      setError('搜索病人失败。');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedPatient || !selectedScheduleId || !selectedTime || !doctorProfile) {
      setError('请选择病人、日期和时间段。');
      return;
    }
    
    const schedule = schedules.find(s => s.id === selectedScheduleId);
    if (!schedule) return;

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedPatient.userId, // Correct: Use the patient's User ID
          patientId: selectedPatient.id,    // Correct: Use the Patient Profile ID
          doctorId: doctorProfile.id,
          scheduleId: selectedScheduleId,
          time: selectedTime,
          roomId: schedule.roomId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '预约失败。');
      }
      
      setSuccess(`成功为${selectedPatient.name}于${selectedTime}预约。`);
      // Reset form
      setPatientSearch('');
      setSearchedPatients([]);
      setSelectedPatient(null);
      setSelectedScheduleId('');
      setSelectedTime('');

    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  // --- Render Logic ---
  if (isLoading || status === 'loading') return <div className="container mx-auto p-8 text-center">加载中...</div>;
  if (error) return <div className="container mx-auto p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <h1 className="text-3xl font-bold mb-6">为病人预约</h1>
      <form onSubmit={handleSubmit} className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md space-y-6">
        
        {/* Patient Selection */}
        <div>
          <h2 className="text-xl font-semibold mb-2">1. 查找病人</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="按用户名或姓名搜索..."
              className="flex-grow block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 shadow-sm text-gray-900"
            />
            <button type="button" onClick={handlePatientSearch} className="py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700">搜索</button>
          </div>
          {searchedPatients.length > 0 && (
            <ul className="mt-2 border rounded-md max-h-40 overflow-y-auto">
              {searchedPatients.map(p => (
                <li key={p.id} onClick={() => { setSelectedPatient(p); setSearchedPatients([]); setPatientSearch(p.name); }} className="p-2 hover:bg-gray-100 cursor-pointer text-gray-900">
                  {p.name} ({p.username})
                </li>
              ))}
            </ul>
          )}
          {selectedPatient && <p className="mt-2 text-green-600 text-gray-900">已选择：{selectedPatient.name} ({selectedPatient.username})</p>}
        </div>

        {/* Schedule Selection */}
        <div>
          <h2 className="text-xl font-semibold mb-2">2. 选择预约时段</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="schedule" className="block text-sm font-medium">日期与诊室</label>
              <select id="schedule" value={selectedScheduleId} onChange={e => { setSelectedScheduleId(e.target.value); setSelectedTime(''); }} className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 shadow-sm text-gray-900" required>
                <option value="">-- 选择排班 --</option>
                {schedules.map(s => <option key={s.id} value={s.id}>{s.date} ({s.roomName})</option>)}
              </select>
            </div>
            {selectedScheduleId && (
              <div>
                <label className="block text-sm font-medium">时间段</label>
                <div className="grid grid-cols-4 gap-2 mt-1">
                  {schedules.find(s => s.id === selectedScheduleId)?.timeSlots.map(slot => (
                    <button
                      type="button"
                      key={slot.time}
                      onClick={() => setSelectedTime(slot.time)}
                      disabled={slot.booked >= slot.total}
                      className={`p-2 border rounded-md text-center text-sm ${selectedTime === slot.time ? 'bg-indigo-600 text-white' : 'bg-white'} ${slot.booked >= slot.total ? 'bg-gray-200 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                    >
                      {slot.time} ({slot.booked}/{slot.total})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submission */}
        <button type="submit" className="w-full py-3 px-4 bg-green-600 text-white font-semibold rounded-md shadow-md hover:bg-green-700" disabled={!selectedPatient || !selectedTime}>
          确认预约
        </button>

        {success && <p className="mt-4 text-green-700 text-center">{success}</p>}
        {error && <p className="mt-4 text-red-700 text-center">{error}</p>}
      </form>
    </div>
  );
}
