'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface AuditLog {
  id: string;
  timestamp: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

// --- Component ---
export default function AdminAuditLogPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'ADMIN') {
      setError('Access Denied: You must be an admin to view this page.');
    }
  }, [status, session, router]);

  // Fetch audit logs
  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'ADMIN') return;
    
    const fetchLogs = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/audit-log');
        if (!res.ok) throw new Error('Failed to fetch audit logs.');
        const data = await res.json();
        setLogs(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setIsLoading(false);
      }
    };
    fetchLogs();
  }, [status, session]);

  if (status === 'loading' || isLoading) return <div className="container mx-auto p-8 text-center">Loading...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="container mx-auto p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <h1 className="text-3xl font-bold mb-6">Audit Log</h1>
      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}

      <div className="bg-white p-4 border rounded-lg shadow-md">
        <div className="space-y-4">
          {logs.length > 0 ? logs.map(log => (
            <div key={log.id} className="p-3 border rounded-md bg-gray-50 text-sm">
              <p className="font-semibold">Action: {log.action} on {log.entityType} {log.entityId ? `(ID: ${log.entityId})` : ''}</p>
              <p className="text-gray-600">By: {log.userEmail} ({log.userRole}) at {new Date(log.timestamp).toLocaleString()}</p>
              {log.details && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-gray-500">Details</summary>
                  <pre className="bg-gray-100 p-2 rounded-md mt-1 overflow-x-auto text-xs">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )) : <p className="text-gray-500">No audit logs found.</p>}
        </div>
      </div>
    </div>
  );
}
