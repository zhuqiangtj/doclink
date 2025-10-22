'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface Doctor {
  id: string;
  name: string;
}

interface Schedule {
  id: string;
  date: string;
  room: { id: string; name: string };
  timeSlots: { time: string; total: number; booked: number }[];
}

// --- Component ---
export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Data states
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [patientId, setPatientId] = useState<string | null>(null);

  // UI states
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<{ scheduleId: string; roomId: string; time: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
  }, [status, router]);

  // Fetch doctors and patient profile on initial load after session is verified
  useEffect(() => {
    if (status !== 'authenticated') return;

    const fetchData = async () => {
      try {
        // Fetch doctors
        const res = await fetch('/api/doctors');
        if (!res.ok) throw new Error("Could not fetch doctors.");
        const data = await res.json();
        setDoctors(data);

        // Fetch patient profile for the logged-in user
        // This is a simplified approach. In a real app, you might have a dedicated endpoint.
        const userRes = await fetch(`/api/user/${session.user.id}`);
        if (!userRes.ok) throw new Error("Could not fetch user profile.");
        const userData = await userRes.json();
        if (userData.patientProfile) {
          setPatientId(userData.patientProfile.id);
        } else {
          // Handle case where a non-patient user (e.g., admin) is logged in
          // Or a patient profile needs to be created.
          setError("No patient profile found for this user.");
        }

      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    };
    fetchData();
  }, [status, session]);

  // Fetch schedules when a doctor is selected
  useEffect(() => {
    if (!selectedDoctorId) {
      setSchedules([]);
      return;
    }

    const fetchSchedules = async () => {
      setIsLoading(true);
      setError(null);
      setSchedules([]);
      setSelectedSlot(null);
      try {
        const res = await fetch(`/api/public/schedules?doctorId=${selectedDoctorId}`);
        if (!res.ok) throw new Error("Could not fetch schedules.");
        const data = await res.json();
        setSchedules(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSchedules();
  }, [selectedDoctorId]);

  const handleBooking = async () => {
    if (!selectedSlot || !selectedDoctorId || !session?.user?.id || !patientId) {
      setError("Please select a doctor, a time slot, and ensure you are logged in correctly.");
      return;
    }
    setError(null);
    setSuccessMessage('');

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: session.user.id,
          patientId: patientId,
          doctorId: selectedDoctorId,
          scheduleId: selectedSlot.scheduleId,
          time: selectedSlot.time,
          roomId: selectedSlot.roomId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Booking failed.");
      }

      setSuccessMessage(`Appointment booked successfully for ${selectedSlot.time}!`);
      setSelectedSlot(null);
      // Refresh schedules to show updated availability
      const schedulesRes = await fetch(`/api/public/schedules?doctorId=${selectedDoctorId}`);
      const data = await schedulesRes.json();
      setSchedules(data);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  // Render loading state while session is being checked
  if (status === 'loading') {
    return <main className="container mx-auto p-8 text-center">Loading session...</main>;
  }

  // Render nothing or a redirect message if unauthenticated
  if (status === 'unauthenticated') {
    return <main className="container mx-auto p-8 text-center">Redirecting to sign in...</main>;
  }

  return (
    <main className="container mx-auto p-4 sm:p-6 md:p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-6">预约挂号 (Book an Appointment)</h1>

        {/* Step 1: Select Doctor */}
        <div className="mb-6">
          <label htmlFor="doctor-select" className="block text-lg font-medium text-gray-800 mb-2">
            第一步: 选择医生 (Step 1: Select a Doctor)
          </label>
          <select
            id="doctor-select"
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            className="block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">-- Please select a doctor --</option>
            {doctors.map((doc) => (
              <option key={doc.id} value={doc.id}>{doc.name}</option>
            ))}
          </select>
        </div>

        {/* Step 2: Select Time Slot */}
        {selectedDoctorId && (
          <div>
            <h2 className="text-lg font-medium text-gray-800 mb-2">
              第二步: 选择时间 (Step 2: Select a Time Slot)
            </h2>
            {isLoading && <p>Loading available times...</p>}
            {error && <p className="text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
            <div className="space-y-4">
              {schedules.map((schedule) => (
                <div key={schedule.id} className="p-4 border rounded-lg">
                  <h3 className="font-semibold">{schedule.date} ({schedule.room.name})</h3>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                    {schedule.timeSlots.map((slot) => (
                      <button
                        key={slot.time}
                        onClick={() => setSelectedSlot({ scheduleId: schedule.id, roomId: schedule.room.id, time: slot.time })}
                        disabled={slot.booked >= slot.total}
                        className={`p-2 border rounded-md text-center text-sm
                          ${selectedSlot?.scheduleId === schedule.id && selectedSlot?.time === slot.time
                            ? 'bg-indigo-600 text-white ring-2 ring-indigo-500'
                            : 'bg-white text-gray-700 hover:bg-gray-50'
                          }
                          ${slot.booked >= slot.total ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : ''}
                        `}
                      >
                        {slot.time}
                        <span className="block text-xs">({slot.booked}/{slot.total})</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Confirm and Book */}
        {selectedSlot && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg text-center">
             <p className="font-semibold mb-3">
              您已选择: {selectedSlot.time}
            </p>
            <button
              onClick={handleBooking}
              className="w-full max-w-xs py-3 px-4 bg-green-600 text-white font-semibold rounded-md shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              确认预约 (Confirm Booking)
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mt-6 p-4 bg-green-100 text-green-800 rounded-lg text-center">
            {successMessage}
          </div>
        )}
      </div>
    </main>
  );
}
