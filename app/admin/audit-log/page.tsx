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
  entityName?: string; // API enriched name when entityType is User
  details?: Record<string, unknown>;
}

// --- Component ---
export default function AdminAuditLogPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const actionZh = (action: string) => {
    const map: Record<string, string> = {
      // 管理员相关
      ADMIN_CREATE_USER: '管理员创建用户',
      ADMIN_RESET_PASSWORD: '管理员重置用户密码',
      ADMIN_UPDATE_USER_DETAILS: '管理员更新用户信息',
      ADMIN_UPDATE_PATIENT_PROFILE: '管理员更新患者资料',
      ADMIN_DELETE_USER: '管理员删除用户',
      // 账户与个人资料
      REGISTER_PATIENT: '用户注册为患者',
      UPDATE_PROFILE: '更新个人资料',
      CHANGE_PASSWORD: '修改密码',
      // 房间/病房
      CREATE_ROOM: '创建病房',
      UPDATE_ROOM: '更新病房信息',
      DELETE_ROOM: '删除病房',
      // 排班时段
      CREATE_SCHEDULE_TIMESLOT: '创建排班时段',
      UPDATE_SCHEDULE_TIMESLOT: '更新排班时段',
      DELETE_SCHEDULE_TIMESLOT: '删除排班时段',
      // 预约
      CREATE_APPOINTMENT: '创建预约',
      CANCEL_APPOINTMENT: '取消预约',
      UPDATE_APPOINTMENT_STATUS: '更新预约状态',
      MARK_NO_SHOW: '标记预约为爽约',
      DOCTOR_MARK_NO_SHOW: '医生标记预约为爽约',
      PATIENT_CHECK_IN: '患者签到',
    };
    if (map[action]) return map[action];
    // Fallback: auto-translate common tokens for unknown actions
    const tokenMap: Record<string, string> = {
      ADMIN: '管理员',
      CREATE: '创建',
      UPDATE: '更新',
      DELETE: '删除',
      RESET: '重置',
      REGISTER: '注册',
      CHANGE: '修改',
      CANCEL: '取消',
      MARK: '标记',
      CHECK: '检查',
      CHECKIN: '签到',
      CHECK_IN: '签到',
      NO: '',
      SHOW: '爽约',
      STATUS: '状态',
      DETAILS: '信息',
      PASSWORD: '密码',
      PROFILE: '资料',
      USER: '用户',
      PATIENT: '患者',
      DOCTOR: '医生',
      APPOINTMENT: '预约',
      ROOM: '病房',
      SCHEDULE: '排班',
      TIMESLOT: '时段',
    };
    const parts = action.split('_');
    const translated = parts
      .map(p => tokenMap[p] ?? p.toLowerCase())
      .filter(Boolean)
      .join(' ');
    return translated || action;
  };

  const entityZh = (type: string) => {
    const map: Record<string, string> = {
      User: '用户',
      Patient: '患者',
      Doctor: '医生',
      Appointment: '预约',
      Room: '病房',
      TimeSlot: '时段',
      Schedule: '排班',
    };
    return map[type] || type;
  };

  const displayEntity = (log: AuditLog) => {
    if (log.entityType === 'User') return `用户：${log.entityName || log.entityId || ''}`;
    if (log.entityType === 'Patient') return `患者：${log.entityName || log.entityId || ''}`;
    if (log.entityType === 'Doctor') return `医生：${log.entityName || log.entityId || ''}`;
    if (log.entityType === 'Room') return `病房：${log.entityName || log.entityId || ''}`;
    if (log.entityType === 'Appointment') return `预约：${log.entityName || log.entityId || ''}`;
    if (log.entityType === 'TimeSlot') return `时段：${log.entityName || log.entityId || ''}`;
    return `${entityZh(log.entityType)}${log.entityId ? `：${log.entityId}` : ''}`;
  };

  // Auth check
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'ADMIN') {
      setError('访问被拒绝：您必须是管理员才能查看此页面。');
    }
  }, [status, session, router]);

  // Fetch audit logs with pagination
  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'ADMIN') return;

    const fetchLogs = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/audit-log?page=${page}&pageSize=${pageSize}`);
        if (!res.ok) throw new Error('获取审计日志失败。');
        const data = await res.json();
        setLogs(data.items || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchLogs();
  }, [status, session, page, pageSize]);

  useEffect(() => {
    if (!overlayText) return;
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  useEffect(() => {
    if (error) setOverlayText(error);
  }, [error]);

  if (status === 'loading' || isLoading) return <div className="mobile-loading">加载中...</div>;
  if (session?.user.role !== 'ADMIN') return <div className="mobile-access-denied">{error}</div>;

  return (
    <div className="mobile-container">
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[2000]">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      <h1 className="mobile-header">审计日志</h1>
      

      <div className="mobile-content-section">
        <div className="mobile-pagination" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button
            className="mobile-button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || isLoading}
          >上一页</button>
          <span>第 {page} / {totalPages} 页（共 {total} 条）</span>
          <button
            className="mobile-button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isLoading}
          >下一页</button>
          <select
            className="mobile-select"
            value={pageSize}
            onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
          >
            {[10, 20, 50, 100].map(size => (
              <option key={size} value={size}>{size} / 页</option>
            ))}
          </select>
        </div>
        <div className="mobile-logs-list">
          {logs.length > 0 ? logs.map(log => (
            <div key={log.id} className="mobile-log-item">
              <p className="mobile-log-action">操作：{actionZh(log.action)}（{displayEntity(log)}）</p>
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
