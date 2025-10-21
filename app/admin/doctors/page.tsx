'use client';

import { useState, useEffect, FormEvent } from 'react';

// Define interfaces for our data structures
interface Room {
  id: string;
  name: string;
  bedCount: number;
}

interface Doctor {
  id: string;
  name:string;
  accountId: string;
  rooms: Room[];
}

export default function DoctorsPage() {
  // State for doctors and rooms lists
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  // State for the form inputs
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);

  // State for loading and error handling
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial data (doctors and rooms)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const [doctorsRes, roomsRes] = await Promise.all([
          fetch('/api/doctors'),
          fetch('/api/rooms'),
        ]);
        if (!doctorsRes.ok || !roomsRes.ok) {
          throw new Error('Failed to fetch data');
        }
        const doctorsData = await doctorsRes.json();
        const roomsData = await roomsRes.json();
        setDoctors(doctorsData);
        setRooms(roomsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleRoomSelection = (roomId: string) => {
    setSelectedRoomIds(prev =>
      prev.includes(roomId)
        ? prev.filter(id => id !== roomId)
        : [...prev, roomId]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (selectedRoomIds.length === 0) {
      setError("Please select at least one room.");
      return;
    }

    try {
      const response = await fetch('/api/doctors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, accountId, roomIds: selectedRoomIds }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create doctor');
      }

      // Reset form and refresh doctor list
      setName('');
      setAccountId('');
      setSelectedRoomIds([]);
      const newDoctor = await response.json();
      setDoctors(prev => [...prev, newDoctor]);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">医生管理 (Doctor Management)</h1>

      <div className="mb-8 p-4 border rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-2">添加新医生 (Add New Doctor)</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name and Account ID inputs */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">医生姓名 (Doctor Name)</label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required />
          </div>
          <div>
            <label htmlFor="accountId" className="block text-sm font-medium text-gray-700">登录账号 (Account ID)</label>
            <input id="accountId" type="text" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required />
          </div>

          {/* Room Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700">关联诊室 (Assign to Rooms)</label>
            <div className="mt-2 space-y-2 p-2 border rounded-md">
              {rooms.length > 0 ? rooms.map(room => (
                <div key={room.id} className="flex items-center">
                  <input
                    id={`room-${room.id}`}
                    type="checkbox"
                    checked={selectedRoomIds.includes(room.id)}
                    onChange={() => handleRoomSelection(room.id)}
                    className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor={`room-${room.id}`} className="ml-2 block text-sm text-gray-900">{room.name}</label>
                </div>
              )) : <p className="text-sm text-gray-500">No rooms available. Please add a room first.</p>}
            </div>
          </div>

          <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">添加 (Add)</button>
        </form>
        {error && <p className="mt-4 text-red-500">{error}</p>}
      </div>

      <div className="p-4 border rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-2">现有医生 (Existing Doctors)</h2>
        {isLoading ? <p>Loading...</p> : (
          <ul className="space-y-3">
            {doctors.map((doctor) => (
              <li key={doctor.id} className="p-3 border rounded-md">
                <p className="font-semibold">{doctor.name} <span className="font-normal text-gray-600">({doctor.accountId})</span></p>
                <p className="text-sm text-gray-500">
                  诊室: {doctor.rooms.map(room => room.name).join(', ') || 'N/A'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
