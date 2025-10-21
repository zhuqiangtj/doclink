'use client';

import { useState, useEffect, FormEvent } from 'react';

interface Room {
  id: string;
  name: string;
  bedCount: number;
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const [bedCount, setBedCount] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/rooms');
      if (!response.ok) {
        throw new Error('Failed to fetch rooms');
      }
      const data = await response.json();
      setRooms(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, bedCount: Number(bedCount) }),
      });

      if (!response.ok) {
        throw new Error('Failed to create room');
      }

      // Clear form and refresh list
      setName('');
      setBedCount('');
      fetchRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">诊室管理 (Room Management)</h1>

      <div className="mb-8 p-4 border rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-2">添加新诊室 (Add New Room)</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              诊室名称 (Room Name)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="bedCount" className="block text-sm font-medium text-gray-700">
              默认床位数 (Default Bed Count)
            </label>
            <input
              id="bedCount"
              type="number"
              value={bedCount}
              onChange={(e) => setBedCount(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              required
            />
          </div>
          <button
            type="submit"
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            添加 (Add)
          </button>
        </form>
        {error && <p className="mt-4 text-red-500">{error}</p>}
      </div>

      <div className="p-4 border rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-2">现有诊室 (Existing Rooms)</h2>
        {isLoading ? (
          <p>Loading...</p>
        ) : (
          <ul className="space-y-2">
            {rooms.map((room) => (
              <li key={room.id} className="p-2 border-b flex justify-between items-center">
                <span>{room.name}</span>
                <span className="text-gray-500">床位数 (Beds): {room.bedCount}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
