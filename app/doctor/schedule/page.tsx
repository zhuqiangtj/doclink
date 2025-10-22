'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; rooms: Room[]; }
interface Appointment {
  id: string;
  date: string;
  time: string;
  room: { name: string };
  patient: { name: string };
  status: string;
  bedId: number;
}
interface Schedule { id: string; date: string; room: Room; timeSlots: TimeSlot[]; }
interface TimeSlot { time: string; total: number; booked: number; }

// --- Constants ---
const DEFAULT_TIMES = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
const statusColors: { [key: string]: string } = {
  pending: 'bg-yellow-200 text-yellow-800',
  CHECKED_IN: 'bg-blue-200 text-blue-800',
  CONFIRMED: 'bg-green-200 text-green-800',
  COMPLETED: 'bg-gray-500 text-gray-900',
  NO_SHOW: 'bg-red-200 text-red-800',
  CANCELLED: 'bg-purple-200 text-purple-800',
};
const isToday = (dateString: string) => new Date(dateString).toDateString() === new Date().toDateString();

// --- Component ---
export default function DoctorDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [bedAssignments, setBedAssignments] = useState<{ [key: string]: string }>({});

  // --- Form States ---
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduleRoomId, setScheduleRoomId] = useState('');

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending', 'confirmed', 'history'

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') setError('Access Denied');
  }, [status, session, router]);

  useEffect(() => {
    if (status !== 'authenticated' || session.user.role !== 'DOCTOR') return;
    const fetchDoctorData = async () => {
      setIsLoading(true);
      try {
        const userRes = await fetch(`/api/user/${session.user.id}`);
        if (!userRes.ok) throw new Error('Failed to fetch doctor profile.');
        const userData = await userRes.json();
        if (!userData.doctorProfile) throw new Error('Doctor profile not found.');
        setDoctorProfile(userData.doctorProfile);
        
        const doctorId = userData.doctorProfile.id;
        const [schedulesRes, appointmentsRes] = await Promise.all([
          fetch(`/api/schedules?doctorId=${doctorId}`),
          fetch(`/api/appointments?doctorId=${doctorId}`)
        ]);
        if (!schedulesRes.ok) throw new Error('Failed to fetch schedules.');
        if (!appointmentsRes.ok) throw new Error('Failed to fetch appointments.');
        setSchedules(await schedulesRes.json());
        setAppointments(await appointmentsRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setIsLoading(false);
      }
    };
    fetchDoctorData();
  }, [status, session]);

  // --- Handlers ---
  const handleCreateSchedule = async (e: FormEvent) => {
    e.preventDefault();
    if (!scheduleDate || !scheduleRoomId || !doctorProfile) {
      setError('Please select a date and a room.');
      return;
    }
    setError(null);
    setSuccess(null);

    const room = doctorProfile.rooms.find(r => r.id === scheduleRoomId);
    if (!room) return;

    const timeSlots: TimeSlot[] = DEFAULT_TIMES.map(time => ({
      time,
      total: room.bedCount,
      booked: 0,
    }));

    try {
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: doctorProfile.id,
          roomId: scheduleRoomId,
          date: scheduleDate,
          timeSlots,
        }),
      });
      if (!response.ok) throw new Error('Failed to create schedule.');
      
      const newSchedule = await response.json();
      setSchedules(prev => [...prev, { ...newSchedule, room }]);
      setSuccess('Schedule created successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    setError(null);
    setSuccess(null);
    if (window.confirm('Are you sure you want to cancel this appointment?')) {
      try {
        const response = await fetch(`/api/appointments?appointmentId=${appointmentId}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Failed to cancel appointment.');
        }
        setAppointments(prev => prev.filter(apt => apt.id !== appointmentId));
        setSuccess('Appointment cancelled successfully.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    }
  };

  const handleCheckinConfirmation = async (appointmentId: string, action: 'CONFIRM' | 'DENY') => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Action failed.');
      }
      const updatedAppointment = await response.json();
      setAppointments(prev => prev.map(apt => apt.id === appointmentId ? updatedAppointment : apt));
      setSuccess(`Check-in ${action.toLowerCase()}ed successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  const handleCompleteAppointment = async (appointmentId: string) => {
    const bedId = bedAssignments[appointmentId];
    if (!bedId || isNaN(parseInt(bedId))) {
      setError('Please enter a valid bed number.');
      return;
    }
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/appointments/${appointmentId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bedId: parseInt(bedId) }),
      });
      if (!response.ok) throw new Error('Failed to complete appointment.');
      const updatedAppointment = await response.json();
      setAppointments(prev => prev.map(apt => apt.id === appointmentId ? updatedAppointment : apt));
      setSuccess('Appointment marked as complete.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  // --- Filtering Logic ---
  const pendingAppointments = appointments.filter(apt => isToday(apt.date) && ['pending', 'CHECKED_IN'].includes(apt.status));
  const confirmedTodayAppointments = appointments.filter(apt => isToday(apt.date) && apt.status === 'CONFIRMED');
  const historyAppointments = appointments.filter(apt => !isToday(apt.date) || ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(apt.status));

  // --- Render Logic ---
  if (status === 'loading' || isLoading) return <div className="container mx-auto p-8 text-center">Loading...</div>;
  if (!session || session.user.role !== 'DOCTOR' || !doctorProfile) {
    return <div className="container mx-auto p-8 text-center"><h1 className="text-2xl font-bold text-red-600">Access Denied</h1><p className="mt-2">{error || 'You must be logged in as a doctor.'}</p></div>;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <h1 className="text-3xl font-bold mb-6">Doctor Dashboard ({doctorProfile.name})</h1>
      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
      {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Column 1: Scheduling */}
        <div className="lg:col-span-1 space-y-6">
          <div className="p-4 border rounded-lg shadow-md bg-white">
            <h2 className="text-xl font-semibold mb-4">Create New Schedule</h2>
            <form onSubmit={handleCreateSchedule} className="grid grid-cols-1 gap-4 items-end">
              <div>
                <label htmlFor="date" className="block text-sm font-medium">Date</label>
                <input type="date" id="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" required/>
              </div>
              <div>
                <label htmlFor="room" className="block text-sm font-medium">Room</label>
                <select id="room" value={scheduleRoomId} onChange={e => setScheduleRoomId(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" required>
                  <option value="">-- Select a Room --</option>
                  {doctorProfile.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
              </div>
              <button type="submit" className="py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Create Schedule</button>
            </form>
          </div>

          {/* Existing Schedules */}
          <div className="p-4 border rounded-lg shadow-md bg-white">
            <h2 className="text-xl font-semibold mb-4">My Schedules</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {schedules.map(sch => (
                <div key={sch.id} className="p-3 border rounded-md bg-gray-50">
                  <p className="font-semibold">{sch.date}</p>
                  <p className="text-sm text-gray-600">Room: {sch.room.name}</p>
                  <details className="text-xs mt-1">
                    <summary className="cursor-pointer">View Details</summary>
                    <ul className="pl-4 mt-1">
                      {sch.timeSlots.map(ts => (
                        <li key={ts.time}>{ts.time} - {ts.booked}/{ts.total} beds</li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Column 2 & 3: Appointment Management */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-4 border rounded-lg shadow-md bg-white">
            <h2 className="text-xl font-semibold mb-4">Appointments</h2>
            {/* Tabs */}
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                <button onClick={() => setActiveTab('pending')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'pending' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Pending Actions</button>
                <button onClick={() => setActiveTab('confirmed')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'confirmed' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Today&apos;s Confirmed</button>
                <button onClick={() => setActiveTab('history')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'history' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>History</button>
              </nav>
            </div>

            {/* Tab Panels */}
            <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
              {activeTab === 'pending' && pendingAppointments.map(apt => (
                <div key={apt.id} className="p-3 border rounded-md bg-gray-50 text-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{apt.patient.name}</p>
                      <p className="text-gray-600">{new Date(apt.date).toLocaleDateString()} at {apt.time}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs ${statusColors[apt.status] || 'bg-gray-200'}`}>{apt.status.replace('_',' ')}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t flex items-center gap-2">
                    {apt.status === 'CHECKED_IN' ? (
                      <>
                        <button onClick={() => handleCheckinConfirmation(apt.id, 'CONFIRM')} className="text-xs py-1 px-2 bg-green-500 text-white rounded">Confirm</button>
                        <button onClick={() => handleCheckinConfirmation(apt.id, 'DENY')} className="text-xs py-1 px-2 bg-red-500 text-white rounded">Deny</button>
                      </>
                    ) : apt.status === 'pending' ? (
                      <button onClick={() => handleCancelAppointment(apt.id)} className="text-red-500 hover:text-red-700 text-xs">Cancel Appointment</button>
                    ) : null}
                  </div>
                </div>
              ))}
              {activeTab === 'confirmed' && confirmedTodayAppointments.map(apt => (
                <div key={apt.id} className="p-3 border rounded-md bg-gray-50 text-sm">
                  <p className="font-semibold">{apt.patient.name} at {apt.time}</p>
                  <div className="mt-2 flex gap-2 items-center">
                    <input type="number" placeholder="Bed #" value={bedAssignments[apt.id] || ''} onChange={e => setBedAssignments({...bedAssignments, [apt.id]: e.target.value})} className="w-20 p-1 border rounded-md" />
                    <button onClick={() => handleCompleteAppointment(apt.id)} className="py-1 px-3 bg-green-600 text-white rounded-md text-xs">Complete</button>
                  </div>
                </div>
              ))}
              {activeTab === 'history' && historyAppointments.map(apt => (
                <div key={apt.id} className="p-3 border rounded-md bg-gray-100 text-sm"> 
                  <p>{new Date(apt.date).toLocaleDateString()} - {apt.patient.name} <span className={`px-2 py-1 rounded-full text-xs ${statusColors[apt.status]}`}>{apt.status.replace('_',' ')}</span></p>
                  {apt.status === 'COMPLETED' && <p className="text-xs text-gray-600">Finished at Bed #{apt.bedId}</p>}
                  {apt.status === 'NO_SHOW' && <p className="text-xs text-red-600">Missed appointment.</p>}
                </div>
              ))}
            </div>
            <button onClick={() => router.push('/doctor/book-appointment')} className="w-full mt-4 py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700">Book for a Patient</button>
          </div>
        </div>
      </div>
    </div>
  );
}