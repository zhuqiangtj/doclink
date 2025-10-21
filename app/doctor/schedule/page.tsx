'use client';

import { useState, useEffect, FormEvent } from 'react';

// Interfaces
interface Room {
  id: string;
  name: string;
  bedCount: number;
}

interface Doctor {
  id: string;
  name: string;
  accountId: string;
  rooms: Room[];
}

interface Schedule {
  id: string;
  date: string;
  room: Room;
  timeSlots: TimeSlot[];
}

interface TimeSlot {
  time: string;
  total: number;
  booked: number;
}

// Default time slots as per README
const DEFAULT_TIMES = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

export default function SchedulePage() {
  // Data states
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  // Form states
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // UI states
  const [error, setError] = useState<string | null>(null);

  // Fetch all doctors on component mount
  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        const res = await fetch('/api/doctors');
        if (!res.ok) throw new Error('Failed to fetch doctors');
        const data = await res.json();
        setDoctors(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    };
    fetchDoctors();
  }, []);

  // Fetch schedules when a doctor is selected
  useEffect(() => {
    if (!selectedDoctorId) {
      setSchedules([]);
      return;
    }
    const fetchSchedules = async () => {
      try {
        const res = await fetch(`/api/schedules?doctorId=${selectedDoctorId}`);
        if (!res.ok) throw new Error('Failed to fetch schedules');
        const data = await res.json();
        setSchedules(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    };
    fetchSchedules();
  }, [selectedDoctorId]);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedDoctorId || !selectedRoomId || !selectedDate) {
      setError("Please select a doctor, room, and date.");
      return;
    }

    const room = selectedDoctor?.rooms.find(r => r.id === selectedRoomId);
    if (!room) {
      setError("Selected room is not valid for this doctor.");
      return;
    }

    // Generate the time slots based on the default times and room's bed count
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
          doctorId: selectedDoctorId,
          roomId: selectedRoomId,
          date: selectedDate,
          timeSlots,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create schedule');
      }

      // Refresh schedules list
      const newSchedule = await response.json();
      setSchedules(prev => [...prev, { ...newSchedule, room }]); // Manually add room info for display
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">排班管理 (My Schedule)</h1>

      {/* Doctor Selector */}
      <div className="mb-4">
        <label htmlFor="doctor" className="block text-sm font-medium text-gray-700">
          选择您的医生账号 (Select Your Doctor Profile)
        </label>
        <select
          id="doctor"
          value={selectedDoctorId}
          onChange={(e) => setSelectedDoctorId(e.target.value)}
          className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
        >
          <option value="">-- Select a Doctor --</option>
          {doctors.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
        </select>
      </div>

      {selectedDoctor && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Scheduling Form */}
          <div className="p-4 border rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-2">创建新排班 (Create New Schedule)</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="date">Date</label>
                <input type="date" id="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" />
              </div>
              <div>
                <label htmlFor="room">Room</label>
                <select id="room" value={selectedRoomId} onChange={e => setSelectedRoomId(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" required>
                  <option value="">-- Select a Room --</option>
                  {selectedDoctor.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
              </div>
              <p className="text-sm text-gray-500">
                排班将根据默认时间点和诊室床位数自动创建。 (Schedule will be auto-generated based on default times and room bed count.)
              </p>
              <button type="submit" className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">创建排班 (Create Schedule)</button>
            </form>
            {error && <p className="mt-4 text-red-500">{error}</p>}
          </div>

          {/* Existing Schedules */}
          <div className="p-4 border rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-2">我的排班 (My Schedules)</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {schedules.length > 0 ? schedules.map(sch => (
                <div key={sch.id} className="p-3 border rounded-md bg-gray-50">
                  <p className="font-semibold">{sch.date}</p>
                  <p className="text-sm text-gray-600">诊室 (Room): {sch.room.name}</p>
                  <details className="text-xs mt-1">
                    <summary className="cursor-pointer">查看详情 (View Details)</summary>
                    <ul className="pl-4 mt-1">
                      {(sch.timeSlots as TimeSlot[]).map(ts => (
                        <li key={ts.time}>{ts.time} - {ts.booked}/{ts.total} beds</li>
                      ))}
                    </ul>
                  </details>
                </div>
              )) : <p>No schedules found for this doctor.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
