'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface User {
  id: string;
  email: string;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  patientProfile?: { id: string; name: string; credibilityScore: number; isSuspended: boolean; phone?: string };
  doctorProfile?: { id: string; name: string; rooms?: { id: string; name: string }[] };
}

interface Room {
  id: string;
  name: string;
}

// --- Component ---
export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [users, setUsers] = useState<User[]>([]);
  const [allRooms, setAllRooms] = useState<Room[]>([]); // For assigning rooms to doctors
  
  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'doctors' | 'patients' | 'admins'>('all');
  
  // --- Modal States ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit' | 'reset_password'>('add');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // --- Form States ---
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'PATIENT' | 'DOCTOR' | 'ADMIN'>('PATIENT');
  const [credibilityScore, setCredibilityScore] = useState(15);
  const [isSuspended, setIsSuspended] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);

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
    
    const fetchUsersAndRooms = async () => {
      setIsLoading(true);
      try {
        const [usersRes, roomsRes] = await Promise.all([
          fetch('/api/users'),
          fetch('/api/rooms?all=true'), // Fetch all rooms for admin assignment
        ]);

        if (!usersRes.ok) throw new Error('Failed to fetch users.');
        if (!roomsRes.ok) throw new Error('Failed to fetch rooms.');

        setUsers(await usersRes.json());
        setAllRooms(await roomsRes.json());

      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setIsLoading(false);
      }
    };
    fetchUsersAndRooms();
  }, [status, session]);

  // --- Modal Logic ---
  const openModal = (mode: 'add' | 'edit' | 'reset_password', user: User | null = null) => {
    setModalMode(mode);
    setSelectedUser(user);
    setName(user?.patientProfile?.name || user?.doctorProfile?.name || '');
    setEmail(user?.email || '');
    setRole(user?.role || 'PATIENT');
    setCredibilityScore(user?.patientProfile?.credibilityScore || 15);
    setIsSuspended(user?.patientProfile?.isSuspended || false);
    setSelectedRoomIds(user?.doctorProfile?.rooms?.map(r => r.id) || []);
    setPassword(''); // Always clear password field
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedUser(null);
    setError(null);
    setSuccess(null);
  };

  // --- Handlers ---
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const url = modalMode === 'add' ? '/api/users' : `/api/users?userId=${selectedUser?.id}`;
    const method = modalMode === 'add' ? 'POST' : 'PUT';

    let body: any = {};
    if (modalMode === 'add') {
      body = { name, email, password, role, roomIds: selectedRoomIds };
    } else if (modalMode === 'edit') {
      body = { name, role, credibilityScore, isSuspended, roomIds: selectedRoomIds };
    } else if (modalMode === 'reset_password') {
      body = { password: '123456' }; // Default password for reset
    }

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

      const result = await response.json();
      
      // Refresh user list after operation
      const usersRes = await fetch('/api/users');
      setUsers(await usersRes.json());
      
      setSuccess(`User ${modalMode === 'add' ? 'added' : 'updated'} successfully!`);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  const handleDelete = async (userId: string) => {
    if (window.confirm('Are you sure you want to delete this user? This will delete all associated profiles and data.')) {
      try {
        const response = await fetch(`/api/users?userId=${userId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete user.');
        setUsers(prev => prev.filter(u => u.id !== userId));
        setSuccess('User deleted successfully.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    }
  };

  const handleRoomSelection = (roomId: string) => {
    setSelectedRoomIds(prev =>
      prev.includes(roomId)
        ? prev.filter(id => id !== roomId)
        : [...prev, roomId]
    );
  };

  // --- Filtering Logic ---
  const filteredUsers = users.filter(user => {
    if (activeTab === 'all') return true;
    return user.role.toLowerCase() === activeTab;
  });

  // --- Render Logic ---
  if (status === 'loading' || isLoading) return <div className="container mx-auto p-8 text-center">Loading...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="container mx-auto p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">User Management</h1>
        <button onClick={() => openModal('add')} className="py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
          Add User
        </button>
      </div>

      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
      {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}

      <div className="bg-white p-4 border rounded-lg shadow-md">
        {/* Tabs */}
        <div className="border-b border-gray-200 mb-4">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button onClick={() => setActiveTab('all')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'all' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>All Users</button>
            <button onClick={() => setActiveTab('doctors')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'doctors' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Doctors</button>
            <button onClick={() => setActiveTab('patients')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'patients' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Patients</button>
            <button onClick={() => setActiveTab('admins')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'admins' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Admins</button>
          </nav>
        </div>

        <ul className="space-y-3">
          {filteredUsers.length > 0 ? filteredUsers.map((user) => (
            <li key={user.id} className="p-3 border rounded-md flex justify-between items-center">
              <div>
                <p className="font-semibold">{user.email} <span className="text-sm text-gray-500">({user.role})</span></p>
                {user.patientProfile && <p className="text-sm text-gray-600">Patient: {user.patientProfile.name} (Score: {user.patientProfile.credibilityScore}, Suspended: {user.patientProfile.isSuspended ? 'Yes' : 'No'})</p>}
                {user.doctorProfile && <p className="text-sm text-gray-600">Doctor: {user.doctorProfile.name} (Rooms: {user.doctorProfile.rooms?.map(r => r.name).join(', ') || 'None'})</p>}
              </div>
              <div className="space-x-2">
                <button onClick={() => openModal('edit', user)} className="text-sm text-blue-600 hover:underline">Edit</button>
                <button onClick={() => openModal('reset_password', user)} className="text-sm text-yellow-600 hover:underline">Reset Password</button>
                <button onClick={() => handleDelete(user.id)} className="text-sm text-red-600 hover:underline">Delete</button>
              </div>
            </li>
          )) : <p className="text-gray-500">No users found for this category.</p>}
        </ul>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4 capitalize">{modalMode.replace('_', ' ')} User</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {modalMode === 'add' && (
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="block w-full rounded-md border-gray-300" required />
              )}
              {(modalMode === 'add' || modalMode === 'edit') && (
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="block w-full rounded-md border-gray-300" required />
              )}
              {(modalMode === 'add' || modalMode === 'edit') && (
                <select value={role} onChange={e => setRole(e.target.value as 'PATIENT' | 'DOCTOR' | 'ADMIN')} className="block w-full rounded-md border-gray-300">
                  <option value="PATIENT">Patient</option>
                  <option value="DOCTOR">Doctor</option>
                  <option value="ADMIN">Admin</option>
                </select>
              )}
              {modalMode === 'add' && (
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Initial Password" className="block w-full rounded-md border-gray-300" required />
              )}

              {/* Patient Specific Fields */}
              {selectedUser?.role === 'PATIENT' && modalMode === 'edit' && (
                <>
                  <div>
                    <label className="block text-sm font-medium">Credibility Score</label>
                    <input type="number" value={credibilityScore} onChange={e => setCredibilityScore(parseInt(e.target.value))} className="block w-full rounded-md border-gray-300" />
                  </div>
                  <div className="flex items-center">
                    <input type="checkbox" checked={isSuspended} onChange={e => setIsSuspended(e.target.checked)} id="isSuspended" className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
                    <label htmlFor="isSuspended" className="ml-2 block text-sm text-gray-900">Is Suspended</label>
                  </div>
                </>
              )}

              {/* Doctor Specific Fields */}
              {selectedUser?.role === 'DOCTOR' && modalMode === 'edit' && (
                <div>
                  <label className="block text-sm font-medium">Assigned Rooms</label>
                  <div className="mt-2 space-y-2 p-2 border rounded-md max-h-40 overflow-y-auto">
                    {allRooms.length > 0 ? allRooms.map(room => (
                      <div key={room.id} className="flex items-center">
                        <input
                          id={`room-${room.id}`}
                          type="checkbox"
                          checked={selectedRoomIds.includes(room.id)}
                          onChange={() => handleRoomSelection(room.id)}
                          className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                        />
                        <label htmlFor={`room-${room.id}`} className="ml-2 block text-sm text-gray-900">{room.name}</label>
                      </div>
                    )) : <p className="text-sm text-gray-500">No rooms available.</p>}
                  </div>
                </div>
              )}

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