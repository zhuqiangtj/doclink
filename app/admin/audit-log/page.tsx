'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import './mobile.css';

// --- Interfaces ---
interface AuditLog {
  id: string;
  timestamp: string;
  userId?: string;
  userName?: string;
  userUsername?: string;
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
      setError('访问被拒绝：您必须是管理员才能查看此页面。');
    }
  }, [status, session, router]);

  // Fetch audit logs
  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'ADMIN') return;
    
    const fetchLogs = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/audit-log');
        if (!res.ok) throw new Error('获取审计日志失败。');
        const data = await res.json();
        setLogs(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchLogs();
  }, [status, session]);

  if (status === 'loading' || isLoading) return <div className="mobile-loading">加载中...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="mobile-access-denied">{error}</div>;

  return (
    <div className="mobile-container">
      <h1 className="mobile-header">审计日志</h1>
      {error && <div className="mobile-error">{error}</div>}

      <div className="mobile-content-section">
        <div className="mobile-logs-list">
          {logs.length > 0 ? logs.map(log => (
            <div key={log.id} className="mobile-log-item">
              <p className="mobile-log-action">操作: {log.action} 于 {log.entityType} {log.entityId ? `(ID: ${log.entityId})` : ''}</p>
              <p className="mobile-log-metadata">执行者: {log.userName || log.userUsername} ({log.userRole}) 于 {new Date(log.timestamp).toLocaleString()}</p>
              {log.details && (
                <details className="mobile-log-details">
                  <summary>详情</summary>
                  <pre>
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )) : <div className="mobile-empty-state"><p className="mobile-empty-text">未找到审计日志。</p></div>}
        </div>
      </div>
    </div>
  );
}
