'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AdminDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
    if (status === 'authenticated' && session.user.role !== 'ADMIN') {
      router.push('/'); // Redirect non-admins
    }
  }, [status, session, router]);

  if (status === 'loading') {
    return <div className="container mx-auto p-8 text-center">Loading...</div>;
  }

  if (status === 'authenticated' && session.user.role === 'ADMIN') {
    return (
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Example Dashboard Cards */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-2">Total Users</h2>
            <p className="text-3xl font-bold text-indigo-600">1234</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-2">Total Doctors</h2>
            <p className="text-3xl font-bold text-green-600">50</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-2">Appointments Today</h2>
            <p className="text-3xl font-bold text-blue-600">250</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-2">Pending Check-ins</h2>
            <p className="text-3xl font-bold text-yellow-600">15</p>
          </div>
          {/* Add more cards as needed */}
        </div>
        <p className="mt-8 text-gray-600">Welcome, Admin! Use the navigation below to manage the system.</p>
      </div>
    );
  }

  return null; // Should not reach here if redirects are handled
}
