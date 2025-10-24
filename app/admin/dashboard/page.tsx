'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface DashboardStats {
  totalUsers: number;
  totalDoctors: number;
  totalPatients: number;
}

export default function AdminDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated') {
      if (session.user.role !== 'ADMIN') {
        router.push('/'); // Redirect non-admins
      } else {
        // Fetch stats for admin
        const fetchStats = async () => {
          try {
            const res = await fetch('/api/admin/dashboard');
            if (!res.ok) throw new Error('Failed to fetch dashboard stats.');
            const data = await res.json();
            setStats(data);
          } catch (error) {
            console.error(error);
          } finally {
            setIsLoading(false);
          }
        };
        fetchStats();
      }
    }
  }, [status, session, router]);

  if (status === 'loading' || isLoading) {
    return <div className="container mx-auto p-8 text-center">加载中...</div>;
  }

  if (status === 'authenticated' && session.user.role === 'ADMIN') {
    return (
      <div className="container mx-auto p-6 md:p-10">
        <h1 className="text-4xl font-bold mb-8 text-foreground">管理员仪表板</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <div className="bg-white p-8 rounded-2xl shadow-lg text-center">
            <h2 className="text-2xl font-semibold mb-2">总用户数</h2>
            <p className="text-5xl font-bold text-primary">{stats?.totalUsers ?? 0}</p>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-lg text-center">
            <h2 className="text-2xl font-semibold mb-2">总医生数</h2>
            <p className="text-5xl font-bold text-green-500">{stats?.totalDoctors ?? 0}</p>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-lg text-center">
            <h2 className="text-2xl font-semibold mb-2">总病人数</h2>
            <p className="text-5xl font-bold text-secondary">{stats?.totalPatients ?? 0}</p>
          </div>
        </div>
        <p className="mt-12 text-xl text-gray-600 text-center">欢迎，管理员！请使用下方导航管理系统。</p>
      </div>
    );
  }

  return null; // Should not reach here if redirects are handled
}
