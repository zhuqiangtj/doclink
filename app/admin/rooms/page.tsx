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
      setError('Access Denied: You must be an admin to view this page.');
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

        if (!roomsRes.ok) throw new Error('Failed to fetch rooms.');
        if (!usersRes.ok) throw new Error('Failed to fetch doctors.');

        setRooms(await roomsRes.json());
        // Filter out only doctor profiles from users API response
        const doctorUsers: UserWithDoctorProfile[] = await usersRes.json();
        setDoctors(doctorUsers.filter(user => user.role === 'DOCTOR' && user.doctorProfile).map(user => user.doctorProfile as Doctor));

      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
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
      setError('Please select a doctor for the room.');
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
        throw new Error(errData.error || 'Operation failed.');
      }

      // Refresh room list after operation
      const roomsRes = await fetch('/api/rooms');
      setRooms(await roomsRes.json());
      
      setSuccess(`Room ${modalMode === 'add' ? 'added' : 'updated'} successfully!`);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  const handleDelete = async (roomId: string) => {
    if (window.confirm('Are you sure you want to delete this room? This action cannot be undone.')) {
      try {
        const response = await fetch(`/api/rooms?roomId=${roomId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete room.');
        setRooms(prev => prev.filter(r => r.id !== roomId));
        setSuccess('Room deleted successfully!');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    }
  };

  // --- Render Logic ---
  if (status === 'loading' || isLoading) return <div className="container mx-auto p-8 text-center">Loading...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="container mx-auto p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Room Management</h1>
        <button onClick={() => openModal('add')} className="py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
          Add Room
        </button>
      </div>

      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
      {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}

      <div className="bg-white p-4 border rounded-lg shadow-md">
        <ul className="space-y-3">
          {rooms.length > 0 ? rooms.map((room) => (
            <li key={room.id} className="p-3 border rounded-md flex justify-between items-center">
              <div>
                <p className="font-semibold">{room.name} ({room.bedCount} beds)</p>
                <p className="text-sm text-gray-600">Owner: {room.doctor.name}</p>
              </div>
              <div className="space-x-2">
                <button onClick={() => openModal('edit', room)} className="text-sm text-blue-600 hover:underline">Edit</button>
                <button onClick={() => handleDelete(room.id)} className="text-sm text-red-600 hover:underline">Delete</button>
              </div>
            </li>
          )) : <p className="text-gray-500">No rooms found.</p>}
        </ul>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4 capitalize">{modalMode === 'add' ? 'Add Room' : 'Edit Room'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Room Name" className="block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" required />
            <input type="number" value={bedCount} onChange={e => setBedCount(parseInt(e.target.value, 10))} placeholder="Bed Count" className="block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 text-gray-900" min="1" required />
            
            <div>
              <label htmlFor="doctor-select" className="block text-sm font-medium">Assign Owner Doctor</label>
              <select
                id="doctor-select"
                value={selectedDoctorId}
                onChange={e => setSelectedDoctorId(e.target.value)}
                className="mt-1 block w-full min-h-10 py-2 px-4 rounded-md border-gray-300 shadow-sm text-gray-900"
                required
              >
                <option value="">-- Select a Doctor --</option>
                {doctors.map(doctor => (
                  <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-4">
              <button type="button" onClick={closeModal} className="py-2 px-4 bg-gray-200 rounded-md">Cancel</button>
              <button type="submit" className="py-2 px-4 bg-indigo-600 text-white rounded-md">Save</button>
            </div>
          </form>
        </div>
      </div>
    )}
  </div>
);
}
              