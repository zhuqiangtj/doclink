'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FaCheckCircle } from 'react-icons/fa';
import './mobile.css';

interface PatientNotification {
  id: string;
  createdAt: string;
  doctorName: string;
  message: string;
  type: string;
  isRead: boolean;
  appointmentId?: string;
  appointment?: {
    time: string;
    schedule: { date: string };
    timeSlot?: { startTime: string; endTime: string };
    room?: { name: string };
  };
  timeSlot?: { startTime: string; endTime: string; schedule: { date: string } };
}

export default function PatientNotificationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [notifications, setNotifications] = useState<PatientNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const snapshotRef = useRef<Map<string, string>>(new Map());
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 5;
  const totalPages = Math.max(1, Math.ceil(notifications.length / itemsPerPage));

  const getTitleClass = (type: string): string => {
    if (type === 'APPOINTMENT_CANCELLED_BY_DOCTOR') return 'mobile-notification-title-cancelled';
    if (type === 'DOCTOR_SCHEDULE_UPDATED') return 'mobile-notification-title-schedule';
    if (type === 'APPOINTMENT_RESCHEDULED_BY_DOCTOR') return 'mobile-notification-title-appointment';
    return 'mobile-notification-title-appointment';
  };

  const getCardTypeClass = (type: string): string => {
    if (type === 'APPOINTMENT_CANCELLED_BY_DOCTOR') return 'mobile-notification-card-type-cancelled';
    if (type === 'APPOINTMENT_CREATED_BY_DOCTOR') return 'mobile-notification-card-type-appointment';
    if (type === 'DOCTOR_SCHEDULE_UPDATED') return 'mobile-notification-card-type-schedule';
    if (type === 'APPOINTMENT_RESCHEDULED_BY_DOCTOR') return 'mobile-notification-card-type-appointment';
    return '';
  };

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated' && session.user.role !== 'PATIENT') {
      router.push('/');
    }
  }, [status, session, router]);

  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/patient-notifications');
      if (!res.ok) throw new Error('Failed to fetch notifications.');
      const data = await res.json();
      setNotifications(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchNotifications();
    }
  }, [status]);

  // 拉取患者身份以接入 SSE
  useEffect(() => {
    if (status !== 'authenticated') return;
    (async () => {
      try {
        const res = await fetch('/api/user');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.patientProfile?.id) {
          setPatientId(data.patientProfile.id);
        }
      } catch {
        // 靜默失敗
      }
    })();
  }, [status]);

  // SSE：订阅患者频道的预约相关事件，实时刷新通知列表
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!patientId) return;
    try {
      const es = new EventSource(`/api/realtime/subscribe?kind=patient&id=${patientId}`);
      es.onmessage = async (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          const type = evt?.type as string | undefined;
          const payload = evt?.payload as Record<string, unknown>;
          const actorRole = typeof payload?.actorRole === 'string' ? payload.actorRole : undefined;
          const appointmentId = typeof payload?.appointmentId === 'string' ? payload.appointmentId : undefined;
          const timeSlotId = typeof payload?.timeSlotId === 'string' ? payload.timeSlotId : undefined;
          const upsert = (item: PatientNotification) => {
            setNotifications(prev => {
              const exists = prev.some(n => n.id === item.id);
              if (exists) return prev.map(n => (n.id === item.id ? item : n));
              return [item, ...prev];
            });
          };
          switch (type) {
            case 'APPOINTMENT_CREATED': {
              if (actorRole === 'DOCTOR' && appointmentId) {
                const res = await fetch(`/api/patient-notifications?appointmentId=${appointmentId}`);
                if (res.ok) {
                  const item: PatientNotification = await res.json();
                  upsert(item);
                  setOverlayText('新增通知已同步');
                }
              }
              break;
            }
            case 'APPOINTMENT_CANCELLED': {
              if (actorRole === 'DOCTOR' && appointmentId) {
                const res = await fetch(`/api/patient-notifications?appointmentId=${appointmentId}`);
                if (res.ok) {
                  const item: PatientNotification = await res.json();
                  upsert(item);
                  setOverlayText('取消通知已同步');
                }
              }
              break;
            }
            case 'APPOINTMENT_RESCHEDULED': {
              if (appointmentId) {
                const res = await fetch(`/api/patient-notifications?appointmentId=${appointmentId}`);
                if (res.ok) {
                  const item: PatientNotification = await res.json();
                  upsert(item);
                  setOverlayText('改期通知已同步');
                }
              }
              break;
            }
            case 'DOCTOR_SCHEDULE_UPDATED': {
              const id = timeSlotId || appointmentId;
              if (id) {
                const res = await fetch(`/api/patient-notifications?appointmentId=${id}`);
                if (res.ok) {
                  const item: PatientNotification = await res.json();
                  upsert(item);
                  setOverlayText('日程更新通知已同步');
                }
              }
              break;
            }
            default:
              break;
          }
        } catch {}
      };
      es.onerror = () => {
        // EventSource 自動重連
      };
      return () => es.close();
    } catch (err) {
      console.error('SSE subscribe (patient notifications) failed:', err);
    }
  }, [status, patientId]);

  useEffect(() => {
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  useEffect(() => {
    setCurrentPage(prev => {
      const tp = Math.max(1, Math.ceil(notifications.length / itemsPerPage));
      return prev > tp ? tp : prev;
    });
  }, [notifications]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const res = await fetch('/api/patient-notifications', { cache: 'no-store' });
        if (!res.ok) return;
        const data: PatientNotification[] = await res.json();
        const snap = new Map<string, string>();
        data.forEach(n => { snap.set(n.id, `${n.isRead}|${n.createdAt}|${n.type}`); });
        let changed = false;
        const prev = snapshotRef.current;
        if (prev.size !== snap.size) changed = true;
        if (!changed) {
          for (const [id, val] of snap.entries()) { if (prev.get(id) !== val) { changed = true; break; } }
        }
        snapshotRef.current = snap;
        if (changed) { setNotifications(data); setOverlayText('已自动更新'); }
      } catch {}
    };
    timer = setInterval(run, 60000);
    return () => { if (timer) clearInterval(timer); };
  }, [status]);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const res = await fetch('/api/patient-notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [notificationId] }),
      });
      if (!res.ok) throw new Error('Failed to mark as read.');
      
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, isRead: true } : n)
      );
      window.dispatchEvent(new CustomEvent('notificationRead'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  if (isLoading || status === 'loading') {
    return <div className="mobile-loading">正在加载通知...</div>;
  }

  return (
    <div className="page-container">
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      <h1 className="mobile-header">我的通知</h1>
      {error && <div className="mobile-alert">{error}</div>}
      <div className="mobile-notifications-grid">
        {notifications.length > 0 ? notifications.slice((currentPage - 1) * itemsPerPage, (currentPage - 1) * itemsPerPage + itemsPerPage).map(n => (
          <div key={n.id} className={`mobile-notification-card ${n.isRead ? 'mobile-notification-card-read' : 'mobile-notification-card-unread'} ${getCardTypeClass(n.type)}`}>
            <div className="mobile-notification-content">
              <div className={`mobile-notification-title ${getTitleClass(n.type)}`}>
                {n.type === 'APPOINTMENT_CANCELLED_BY_DOCTOR' ? '预约被取消' : n.type === 'DOCTOR_SCHEDULE_UPDATED' ? '医生日程更新' : n.type === 'APPOINTMENT_RESCHEDULED_BY_DOCTOR' ? '预约改期' : '新预约通知'}
              </div>
              <div className="mobile-notification-details">
                {n.appointment && (
                  <>
                    <div className="mobile-notification-datetime"><strong>日期：</strong>{new Date(n.appointment.schedule.date).toLocaleDateString('zh-CN')}</div>
                    <div className="mobile-notification-datetime"><strong>时间段：</strong>{n.appointment.timeSlot ? `${n.appointment.timeSlot.startTime}-${n.appointment.timeSlot.endTime}` : n.appointment.time}</div>
                    {n.appointment.room?.name && (
                      <div className="mobile-notification-room"><strong>诊室：</strong>{n.appointment.room.name}</div>
                    )}
                  </>
                )}
                {!n.appointment && n.timeSlot && (
                  <>
                    <div className="mobile-notification-datetime"><strong>日期：</strong>{new Date(n.timeSlot.schedule.date).toLocaleDateString('zh-CN')}</div>
                    <div className="mobile-notification-datetime"><strong>时间段：</strong>{`${n.timeSlot.startTime}-${n.timeSlot.endTime}`}</div>
                  </>
                )}
              </div>
              <div className="mobile-notification-message">{n.message}</div>
              <div className="mobile-notification-date"><strong>{
                n.type === 'APPOINTMENT_CREATED_BY_DOCTOR' ? '创建时间' :
                n.type === 'APPOINTMENT_CANCELLED_BY_DOCTOR' ? '取消时间' :
                n.type === 'DOCTOR_SCHEDULE_UPDATED' ? '更新时间' :
                n.type === 'APPOINTMENT_RESCHEDULED_BY_DOCTOR' ? '改期时间' :
                '通知时间'
              }：</strong>{new Date(n.createdAt).toLocaleString('zh-CN')}</div>
            </div>
            {!n.isRead && (
              <button onClick={() => handleMarkAsRead(n.id)} className="mobile-mark-read-btn">
                <FaCheckCircle className="mobile-mark-read-icon" />
                我知道了
              </button>
            )}
          </div>
        )) : (
          <div className="mobile-empty-state">
            <div className="mobile-empty-icon">🔔</div>
            <p className="mobile-empty-text">没有新的通知。</p>
          </div>
        )}
      </div>

      <div className="mobile-pagination">
        <button
          className="mobile-pagination-btn"
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
        >上一页</button>
        <span className="mobile-pagination-info">第 {currentPage} 页，共 {totalPages} 页</span>
        <button
          className="mobile-pagination-btn"
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
        >下一页</button>
      </div>
    </div>
  );
}
