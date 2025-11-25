'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FaCalendarAlt, FaHospital, FaFilter, FaChevronLeft, FaChevronRight, FaTimes, FaCheckCircle, FaBell, FaHistory } from 'react-icons/fa';
import './mobile.css';
import { getStatusText } from '../../../utils/statusText';
import AppointmentHistoryModal from '../../../components/AppointmentHistoryModal';
import CancelAppointmentModal from '../../../components/CancelAppointmentModal';

// --- Interfaces ---
interface Patient {
  user: { name: string; phone?: string; dateOfBirth?: string; gender?: string };
  credibilityScore?: number;
}

interface Doctor {
  user: { name: string };
}

interface Room {
  id: string;
  name: string;
}

interface Appointment {
  id: string;
  date: string;
  time: string;
  status: string;
  reason?: string; // 添加原因字段
  patient: Patient;
  doctor: Doctor;
  room: Room;
  createTime: string;
  statusOperatedAt?: string;
}

interface Notification {
  id: string;
  createdAt: string;
  patientName: string;
  message: string;
  type: string;
  isRead: boolean;
  appointment?: {
    time: string;
    timeSlot?: {
      startTime: string;
      endTime: string;
    };
    schedule: {
      date: string;
    };
    room: {
      name: string;
    };
  };
}

interface DoctorProfile {
  id: string;
  Room: Room[];
}

// --- Component ---
export default function DoctorAppointmentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);

  // --- Notification States ---
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  // --- Filter States ---
  const getCurrentDateInChina = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('PENDING');

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [showNoShowDialog, setShowNoShowDialog] = useState(false);
  const [selectedAppointmentForNoShow, setSelectedAppointmentForNoShow] = useState<Appointment | null>(null);
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [selectedAppointmentForCancel, setSelectedAppointmentForCancel] = useState<Appointment | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const snapshotRef = useRef<{ appointments: Map<string, string>; unread: number }>({ appointments: new Map(), unread: 0 });

  const setCookie = (name: string, value: string, days = 180) => {
    if (typeof document === 'undefined') return;
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
  };
  const getCookie = (name: string): string => {
    if (typeof document === 'undefined') return '';
    const nameEQ = name + '=';
    const parts = document.cookie.split(';');
    for (const p of parts) {
      const c = p.trim();
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
    }
    return '';
  };
  
  // --- History Modal States ---
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session?.user?.role !== 'DOCTOR') {
  setError('访问被拒绝');
    }
  }, [status, session?.user?.role, router]);

  useEffect(() => {
    const s = getCookie('doc_apt_status');
    const r = getCookie('doc_apt_room');
    const d = getCookie('doc_apt_date');
    if (s) setSelectedStatus(s);
    if (r) setSelectedRoomId(r);
    if (d) setSelectedDate(d);
  }, []);

  useEffect(() => { setCookie('doc_apt_status', selectedStatus || ''); }, [selectedStatus]);
  useEffect(() => { setCookie('doc_apt_room', selectedRoomId || ''); }, [selectedRoomId]);
  useEffect(() => { setCookie('doc_apt_date', selectedDate || ''); }, [selectedDate]);

  // 獲取通知數據（僅在醫生身份下觸發，並對 401/404 友好處理）
  // 提取為獨立函數，供初始化與 SSE 事件刷新使用
  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.status === 404 || res.status === 401) {
        // 無醫生資料或未授權：前端不報錯，以空通知呈現
        setNotifications([]);
        setUnreadNotifications([]);
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch notifications.');
      const data = await res.json();
      const allNotifications = data.notifications || [];
      setNotifications(allNotifications);

      // 只顯示最近的未讀通知（最多5條）
      const unread = allNotifications.filter((n: Notification) => !n.isRead).slice(0, 5);
      setUnreadNotifications(unread);
    } catch (err) {
      // 保留日誌但避免不必要的錯誤提示
      console.error('Failed to fetch notifications:', err);
    }
  };

  // 初始化拉取一次通知
  useEffect(() => {
    if (status !== 'authenticated' || session?.user?.role !== 'DOCTOR') return;
    fetchNotifications();
  }, [status, session?.user?.role]);

  // 獨立的獲取預約函數
  const fetchAppointments = async () => {
    try {
      const appointmentsRes = await fetch('/api/appointments');
      if (!appointmentsRes.ok) throw new Error('獲取預約失敗');
      const appointmentsData = await appointmentsRes.json();
      setAppointments(appointmentsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '獲取預約失敗');
    }
  };

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch doctor profile
        const profileRes = await fetch('/api/user');
        if (!profileRes.ok) throw new Error('獲取醫生資料失敗');
        const userData = await profileRes.json();
        if (!userData.doctorProfile) throw new Error('未找到醫生資料');
        setDoctorProfile(userData.doctorProfile);

        // Fetch appointments
        await fetchAppointments();
      } catch (err) {
        setError(err instanceof Error ? err.message : '發生未知錯誤');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [status, session?.user?.id]);

  // 已移除定期輪詢刷新預約列表，改為 SSE 實時驅動

  // SSE：订阅医生频道的实时事件，增量更新预约列表
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!doctorProfile?.id) return;
    try {
      const es = new EventSource(`/api/realtime/subscribe?kind=doctor&id=${doctorProfile.id}`);
      es.onmessage = async (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          const type = evt?.type as string | undefined;
          const payload = (evt?.payload && typeof evt.payload === 'object') ? (evt.payload as Record<string, unknown>) : {};
          const appointmentId = typeof payload['appointmentId'] === 'string' ? (payload['appointmentId'] as string) : undefined;
          const newStatus = typeof payload['newStatus'] === 'string' ? (payload['newStatus'] as string) : undefined;
          const reason = typeof payload['reason'] === 'string' ? (payload['reason'] as string) : undefined;
          switch (type) {
            case 'APPOINTMENT_CREATED': {
              if (appointmentId) {
                try {
                  const res = await fetch(`/api/appointments/${appointmentId}`);
                  if (res.ok) {
                    const item: Appointment = await res.json();
                    setAppointments(prev => {
                      const exists = prev.some(a => a.id === item.id);
                      if (exists) return prev.map(a => (a.id === item.id ? item : a));
                      return [item, ...prev];
                    });
                    setOverlayText('新增预约已同步');
                  }
                } catch {}
              }
              break;
            }
            case 'APPOINTMENT_CANCELLED': {
              if (appointmentId) {
                try {
                  const res = await fetch(`/api/appointments/${appointmentId}`);
                  if (res.ok) {
                    const item: Appointment = await res.json();
                    setAppointments(prev => prev.map(a => (a.id === item.id ? item : a)));
                  } else {
                    setAppointments(prev => prev.map(a => (a.id === appointmentId ? { ...a, status: 'CANCELLED' as const, statusOperatedAt: new Date().toISOString() } : a)));
                  }
                } catch {
                  setAppointments(prev => prev.map(a => (a.id === appointmentId ? { ...a, status: 'CANCELLED' as const, statusOperatedAt: new Date().toISOString() } : a)));
                }
                setOverlayText('取消预约已同步');
              }
              break;
            }
            case 'APPOINTMENT_STATUS_UPDATED': {
              if (appointmentId && newStatus) {
                try {
                  const res = await fetch(`/api/appointments/${appointmentId}`);
                  if (res.ok) {
                    const item: Appointment = await res.json();
                    setAppointments(prev => prev.map(a => (a.id === item.id ? item : a)));
                  } else {
                    setAppointments(prev => prev.map(a => (a.id === appointmentId ? { ...a, status: newStatus, reason, statusOperatedAt: new Date().toISOString() } : a)));
                  }
                } catch {
                  setAppointments(prev => prev.map(a => (a.id === appointmentId ? { ...a, status: newStatus, reason, statusOperatedAt: new Date().toISOString() } : a)));
                }
                setOverlayText('预约状态已同步');
              }
              break;
            }
            default:
              break;
          }
        } catch {}
      };
      es.onerror = () => {
        // EventSource 会自动重连，无需特殊处理
      };
      return () => es.close();
    } catch (err) {
      console.error('SSE subscribe (doctor appointments) failed:', err);
    }
  }, [status, doctorProfile?.id]);

  useEffect(() => {
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const aptRes = await fetch('/api/appointments', { cache: 'no-store' });
        if (aptRes.ok) {
          const data: Appointment[] = await aptRes.json();
          const snapApt = new Map<string, string>();
          data.forEach(a => { snapApt.set(a.id, `${a.status}|${a.date}|${a.time}|${a.room?.name || ''}`); });
          let changed = false;
          const prevApt = snapshotRef.current.appointments;
          if (prevApt.size !== snapApt.size) changed = true;
          if (!changed) {
            for (const [id, val] of snapApt.entries()) { if (prevApt.get(id) !== val) { changed = true; break; } }
          }
          snapshotRef.current.appointments = snapApt;
          if (changed) { setAppointments(data); setOverlayText('已自动更新'); }
        }
        const notifRes = await fetch('/api/notifications', { cache: 'no-store' });
        if (notifRes.ok) {
          const notifData = await notifRes.json();
          const all = notifData.notifications || [];
          const unread = all.filter((n: Notification) => !n.isRead).length;
          if (snapshotRef.current.unread !== unread) {
            setNotifications(all);
            setUnreadNotifications(all.filter((n: Notification) => !n.isRead).slice(0, 5));
            snapshotRef.current.unread = unread;
            setOverlayText('已自动更新');
          }
        }
      } catch {}
    };
    timer = setInterval(run, 60000);
    return () => { if (timer) clearInterval(timer); };
  }, [status]);

  // 狀態工具（位置上移，避免在計算屬性中引用未初始化的變量）
  const isKnownStatus = (s: string): s is 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' => {
    return s === 'PENDING' || s === 'COMPLETED' || s === 'CANCELLED' || s === 'NO_SHOW';
  };

  const normalizeStatus = (status: string): 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' => {
    if (isKnownStatus(status)) return status;
    if (status === 'CHECKED_IN' || status === 'CONFIRMED') return 'PENDING';
    return 'PENDING';
  };

  const getActualStatus = (appointment: Appointment): 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' => {
    return normalizeStatus(appointment.status);
  };

  const getStatusColor = (status: string): string => {
    const colorMap: { [key: string]: string } = {
      'PENDING': 'status-pending',
      'CANCELLED': 'status-cancelled',
      'COMPLETED': 'status-completed',
      'NO_SHOW': 'status-no-show'
    };
    const normalized = normalizeStatus(status);
    return colorMap[normalized] || 'status-default';
  };

  // --- Computed Values ---
  const filteredAppointments = useMemo(() => {
    return appointments.filter(apt => {
      const dateMatch = !selectedDate || apt.date === selectedDate;
      const roomMatch = !selectedRoomId || apt.room.id === selectedRoomId;
      const statusMatch = !selectedStatus || getActualStatus(apt) === selectedStatus;
      return dateMatch && roomMatch && statusMatch;
    });
  }, [appointments, selectedDate, selectedRoomId, selectedStatus, getActualStatus]);

  const sortedAppointments = useMemo(() => {
    return [...filteredAppointments].sort((a, b) => {
      // 按日期（新到舊），再按時間（小到大）
      const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateCompare !== 0) return dateCompare;
      return a.time.localeCompare(b.time);
    });
  }, [filteredAppointments]);

  const paginatedAppointments = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedAppointments.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedAppointments, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedAppointments.length / itemsPerPage);

  // --- Handlers ---
  // 標記通知為已讀
  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [notificationId] }),
      });
      if (!res.ok) throw new Error('Failed to mark as read.');
      
      // 更新本地狀態
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, isRead: true } : n)
      );
      setUnreadNotifications(prev => 
        prev.filter(n => n.id !== notificationId)
      );
      
      // 觸發底部導航欄的未讀計數更新
      window.dispatchEvent(new CustomEvent('notificationRead'));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  // 標記所有通知為已讀（當點擊預約頁面時）
  const handleMarkAllAsRead = async () => {
    if (unreadNotifications.length === 0) return;
    
    try {
      const unreadIds = unreadNotifications.map(n => n.id);
      const res = await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: unreadIds }),
      });
      if (!res.ok) throw new Error('Failed to mark notifications as read.');
      
      // 更新本地狀態
      setNotifications(prev => 
        prev.map(n => unreadIds.includes(n.id) ? { ...n, isRead: true } : n)
      );
      setUnreadNotifications([]);
      
      // 觸發底部導航欄的未讀計數更新
      window.dispatchEvent(new CustomEvent('notificationRead'));
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  // 移除自動標記為已讀的機制：僅在手動點擊「我知道了」時變更狀態

  const openCancelDialog = (appointment: Appointment) => {
    setSelectedAppointmentForCancel(appointment);
    setShowCancelDialog(true);
  };

  const closeCancelDialog = () => {
    if (cancelLoading) return; // 處理中時禁止關閉
    setShowCancelDialog(false);
    setSelectedAppointmentForCancel(null);
  };

  const confirmCancelAppointment = async () => {
    if (!selectedAppointmentForCancel) return;
    try {
      setCancelLoading(true);
      const response = await fetch(`/api/appointments/${selectedAppointmentForCancel.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '取消預約失敗');
      }

      await response.json();
      setAppointments(prev => prev.map(apt => (
        apt.id === selectedAppointmentForCancel.id ? { ...apt, status: 'CANCELLED' as const, statusOperatedAt: new Date().toISOString() } : apt
      )));
      setSuccess(`已成功取消 ${selectedAppointmentForCancel.patient.user.name} 的預約`);
      setTimeout(() => setSuccess(null), 3000);
      closeCancelDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : '取消預約失敗');
    } finally {
      setCancelLoading(false);
    }
  };

  const resetFilters = () => {
    setSelectedDate(getCurrentDateInChina());
    setSelectedRoomId('');
    setSelectedStatus('');
    setCurrentPage(1);
  };

  // 標記爽約
  const handleMarkNoShow = async (appointmentId: string) => {
    try {
      setNoShowLoading(true);
      const res = await fetch('/api/appointments/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId, status: 'NO_SHOW' }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || '標記爽約失敗');
      }

      const prevStatus = selectedAppointmentForNoShow ? normalizeStatus(selectedAppointmentForNoShow.status) : 'PENDING';
      const deducted = prevStatus === 'COMPLETED' ? 6 : 0;
      setSuccess(deducted > 0 ? '已成功標記為爽約，病人已扣除6分' : '已成功標記為爽約');
      
      setAppointments(prev => 
        prev.map(apt => 
          apt.id === appointmentId 
            ? { ...apt, status: 'NO_SHOW' as const, statusOperatedAt: new Date().toISOString() }
            : apt
        )
      );
      
      setShowNoShowDialog(false);
      setSelectedAppointmentForNoShow(null);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '標記爽約時發生錯誤');
      setTimeout(() => setError(null), 3000);
    } finally {
      setNoShowLoading(false);
    }
  };

  // 打開爽約確認對話框
  const openNoShowDialog = (appointment: Appointment) => {
    setSelectedAppointmentForNoShow(appointment);
    setShowNoShowDialog(true);
  };

  // 關閉爽約確認對話框
  const closeNoShowDialog = () => {
    // 處理中時不可關閉對話框
    if (noShowLoading) return;
    setShowNoShowDialog(false);
    setSelectedAppointmentForNoShow(null);
  };

  // 打開歷史記錄模態框
  const openHistoryModal = (appointmentId: string) => {
    setSelectedAppointmentId(appointmentId);
    setShowHistoryModal(true);
  };

  // 關閉歷史記錄模態框
  const closeHistoryModal = () => {
    setShowHistoryModal(false);
    setSelectedAppointmentId(null);
  };


  // 判斷預約是否過期
  const isAppointmentExpired = (date: string, time: string): boolean => {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const appointmentLocal = new Date(year || 0, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0);
    return appointmentLocal.getTime() < Date.now();
  };

  

  const getCreditColorClass = (score?: number | null): 'credit-good' | 'credit-medium' | 'credit-low' | 'credit-neutral' => {
    if (score == null) return 'credit-neutral';
    if (score >= 15) return 'credit-good';
    if (score >= 10) return 'credit-medium';
    return 'credit-low';
  };

  const getGenderInfo = (gender?: string): { text: string; className: 'gender-male' | 'gender-female' | 'gender-other' } => {
    const g = (gender || '').toUpperCase();
    if (g === 'MALE' || g === 'M') return { text: '男', className: 'gender-male' };
    if (g === 'FEMALE' || g === 'F') return { text: '女', className: 'gender-female' };
    return { text: '其他', className: 'gender-other' };
  };

  const calcAgeFromBirthDate = (birthDate?: string): number | null => {
    if (!birthDate) return null;
    try {
      const d = new Date(birthDate);
      const now = new Date();
      let age = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
      return age;
    } catch { return null; }
  };

  // --- Render Logic ---
  if (status === 'loading' || isLoading) {
    return <div className="mobile-loading">正在加載...</div>;
  }

  if (!session || session.user.role !== 'DOCTOR') {
    return (
      <div className="mobile-access-denied">
  <h1 className="mobile-access-title">访问被拒绝</h1>
        <p className="mobile-access-message">{error || '您必須以醫生身份登錄才能查看此頁面。'}</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[2000]">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      <h1 className="mobile-header">预约管理</h1>
      <p className="mobile-description">管理您的所有病人预约信息</p>
      
      {/* 通知區域 */}
      {unreadNotifications.length > 0 && (
        <div className="mobile-notifications-banner">
          <div className="mobile-notifications-header">
            <div className="mobile-notifications-title">
              <FaBell className="mobile-notifications-icon" />
              <span>新通知 ({unreadNotifications.length})</span>
            </div>
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="mobile-notifications-toggle"
            >
  {showNotifications ? '收起' : '展开'}
            </button>
          </div>
          
          {showNotifications && (
            <div className="mobile-notifications-list">
              {unreadNotifications.map(notification => (
                <div key={notification.id} className={`mobile-notification-item ${getNotificationItemClass(notification.type)}`}>
                  <div className="mobile-notification-content">
                    <p className={`mobile-notification-type ${getNotificationTypeClass(notification.type)}`}>
                      {getNotificationLabel(notification.type)}
                    </p>
                    <div className="mobile-notification-details">
                      <p className="mobile-notification-patient">
                        <strong>病人：</strong>{notification.patientName}
                      </p>
                      {notification.appointment && (
                        <>
                          <p className="mobile-notification-datetime">
                            <strong>日期：</strong>{new Date(notification.appointment.schedule.date).toLocaleDateString('zh-CN')}
                          </p>
                          <p className="mobile-notification-datetime">
                            <strong>時間段：</strong>{notification.appointment.timeSlot ? `${notification.appointment.timeSlot.startTime}-${notification.appointment.timeSlot.endTime}` : notification.appointment.time}
                          </p>
                          <p className="mobile-notification-room">
                            <strong>診室：</strong>{notification.appointment.room.name}
                          </p>
                        </>
                      )}
                    </div>
                    <p className="mobile-notification-message">{notification.message}</p>
                    <p className="mobile-notification-date"><strong>{
                      notification.type === 'APPOINTMENT_CREATED' ? '创建时间' :
                      notification.type === 'APPOINTMENT_CANCELLED' ? '取消时间' :
                      '通知时间'
                    }：</strong>{new Date(notification.createdAt).toLocaleString('zh-CN')}</p>
                  </div>
                  <button 
                    onClick={() => handleMarkAsRead(notification.id)} 
                    className="mobile-mark-read-btn"
                  >
                    <FaCheckCircle className="mobile-mark-read-icon" />
                    我知道了
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {error && <div className="mobile-error">{error}</div>}
      {success && <div className="mobile-success">{success}</div>}

      {/* Filters */}
      <div className="mobile-filters-card">
        <h2 className="mobile-filters-title">過濾器</h2>
        
        <div className="mobile-filters-grid">
          <div className="mobile-filter-group">
            <label htmlFor="date-filter" className="mobile-filter-label">日期</label>
            <input
              id="date-filter"
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setCurrentPage(1);
              }}
              className="mobile-filter-input"
            />
          </div>

          <div className="mobile-filter-group">
            <label htmlFor="room-filter" className="mobile-filter-label">诊室</label>
            <select
              id="room-filter"
              value={selectedRoomId}
              onChange={(e) => {
                setSelectedRoomId(e.target.value);
                setCurrentPage(1);
              }}
              className="mobile-filter-select"
            >
              <option value="">所有诊室</option>
              {doctorProfile?.Room.map(room => (
                <option key={room.id} value={room.id}>{room.name}</option>
              ))}
            </select>
          </div>

          <div className="mobile-filter-group">
            <label htmlFor="status-filter" className="mobile-filter-label">狀態</label>
            <select
              id="status-filter"
              value={selectedStatus}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedStatus(next);
                if (next) {
                  setSelectedDate('');
                }
                setCurrentPage(1);
              }}
              className="mobile-filter-select"
            >
              <option value="">所有狀態</option>
              <option value="PENDING">待就診</option>
              <option value="COMPLETED">已完成</option>
              <option value="CANCELLED">已取消</option>
              <option value="NO_SHOW">未到診</option>
            </select>
          </div>
        </div>

        <div className="mobile-filters-actions">
          <button onClick={resetFilters} className="mobile-reset-filters-btn">
            重置過濾器
          </button>
          <span className="mobile-results-count">
            共 {sortedAppointments.length} 條記錄
          </span>
        </div>
      </div>

      {/* 排序選項已移除 */}

      {/* Appointments List */}
      <div className="mobile-content-card">
        <div className="mobile-appointments-list">
          {paginatedAppointments.length > 0 ? paginatedAppointments.map(apt => (
            <div key={apt.id} className={`mobile-appointment-card ${getStatusColor(getActualStatus(apt))}`}>
              <div className="mobile-appointment-header">
                <div className="mobile-patient-info">
                  <div className="mobile-patient-item-inline">
                    <div className="mobile-patient-info-inline">
                      <span className="mobile-patient-name-inline">{apt.patient.user.name}</span>
                      <div className="flex items-center ml-0 shrink-0 space-x-1">
                        {apt.patient.user.phone && (
                          <a className="phone-inline-badge" href={`tel:${String(apt.patient.user.phone).replace(/\s+/g,'')}`} aria-label={`拨打 ${apt.patient.user.phone}`}>{apt.patient.user.phone}</a>
                        )}
                        <span className={`credit-inline-badge ${getCreditColorClass(apt.patient.credibilityScore ?? null)}`}>{typeof apt.patient.credibilityScore === 'number' ? apt.patient.credibilityScore : '未知'}</span>
                        {(() => { const g = getGenderInfo(apt.patient.user.gender); return (<span className={`gender-inline-badge ${g.className}`}>{g.text}</span>); })()}
                        {(() => { const age = calcAgeFromBirthDate(apt.patient.user.dateOfBirth); return (<span className="age-inline-badge">{age != null ? `${age}歲` : '年齡未知'}</span>); })()}
                      </div>
                    </div>
                  </div>
                </div>
                <span className={`mobile-status-badge ${getStatusColor(getActualStatus(apt))}`}>
                  {getStatusText(getActualStatus(apt))}
                </span>
              </div>
              
              <div className="mobile-appointment-details">
                <div className="mobile-detail-row">
                  <span className="mobile-detail-label">診室：</span>
                  <span className="mobile-detail-value">{apt.room.name}</span>
                </div>
                <div className="mobile-detail-row">
                  <span className="mobile-detail-label">目標日期：</span>
                  <span className="mobile-detail-value">{apt.date}</span>
                </div>
                <div className="mobile-detail-row">
                  <span className="mobile-detail-label">目標時間：</span>
                  <span className="mobile-detail-value">{apt.time}</span>
                </div>
                {(apt.status === 'CANCELLED' && apt.statusOperatedAt) && (
                  <div className="mobile-detail-row">
                    <span className="mobile-detail-label">取消時間：</span>
                    <span className="mobile-detail-value">{new Date(apt.statusOperatedAt).toLocaleString('zh-CN')}</span>
                  </div>
                )}
                {(apt.status === 'NO_SHOW' && apt.statusOperatedAt) && (
                  <div className="mobile-detail-row">
                    <span className="mobile-detail-label">爽約標記時間：</span>
                    <span className="mobile-detail-value">{new Date(apt.statusOperatedAt).toLocaleString('zh-CN')}</span>
                  </div>
                )}
                <div className="mobile-detail-row">
                  <span className="mobile-detail-label">操作時間：</span>
                  <span className="mobile-detail-value">{new Date(apt.createTime).toLocaleString('zh-CN')}</span>
                </div>
                {apt.reason && (
                  <div className="mobile-detail-row">
                    <span className="mobile-detail-label">原因：</span>
                    <span className="mobile-detail-value">{apt.reason}</span>
                  </div>
                )}
                {(apt.status === 'COMPLETED' && apt.statusOperatedAt) && (
                  <div className="mobile-detail-row">
                    <span className="mobile-detail-label">{apt.reason && apt.reason.includes('系統') ? '系統自動完成時間' : '完成時間'}：</span>
                    <span className="mobile-detail-value">{new Date(apt.statusOperatedAt).toLocaleString('zh-CN')}</span>
                  </div>
                )}
              </div>

              <div className="mobile-appointment-actions">
                <button 
                  onClick={() => openHistoryModal(apt.id)}
                  className="mobile-history-btn"
                  title="查看历史记录"
                >
                  <FaHistory className="mr-1" />
                  历史记录
                </button>
                
                {apt.status === 'PENDING' && (
                  <button 
                    onClick={() => openCancelDialog(apt)}
                    className="mobile-cancel-appointment-btn"
                  >
                    取消预约
                  </button>
                )}
                
                {apt.status === 'COMPLETED' && (
                  <button 
                    onClick={() => openNoShowDialog(apt)}
                    className="mobile-no-show-btn"
                  >
                    标记爽约
                  </button>
                )}
              </div>
            </div>
          )) : (
            <div className="mobile-empty-state">
              <p className="mobile-empty-text">
                {appointments.length === 0 ? '暂无预约记录' : '没有符合条件的预约记录'}
              </p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mobile-pagination">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="mobile-pagination-btn"
            >
              上一页
            </button>
            
            <span className="mobile-pagination-info">
              第 {currentPage} 页，共 {totalPages} 页
            </span>
            
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="mobile-pagination-btn"
            >
              下一页
            </button>
          </div>
        )}
      </div>

      {/* 爽约确认对话框 */}
      {showNoShowDialog && selectedAppointmentForNoShow && (
        <div className="mobile-dialog-overlay">
          <div className="mobile-dialog">
            <div className="mobile-dialog-header">
              <h3 className="mobile-dialog-title">确认标记爽约</h3>
              <button 
                onClick={closeNoShowDialog}
                className="mobile-dialog-close"
                disabled={noShowLoading}
              >
                <FaTimes />
              </button>
            </div>
            
              <div className="mobile-dialog-content">
              <p className="mobile-dialog-message">
                您确定要将以下预约标记为爽约吗？
              </p>
              
              <div className="mobile-dialog-appointment-info">
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">病人：</span>
                  <span className="mobile-dialog-value">{selectedAppointmentForNoShow.patient.user.name}</span>
                </div>
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">目標日期：</span>
                  <span className="mobile-dialog-value">{selectedAppointmentForNoShow.date}</span>
                </div>
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">目標時間：</span>
                  <span className="mobile-dialog-value">{selectedAppointmentForNoShow.time}</span>
                </div>
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">操作時間（將記錄為）：</span>
                  <span className="mobile-dialog-value">{new Date().toLocaleString('zh-CN')}</span>
                </div>
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">診室：</span>
                  <span className="mobile-dialog-value">{selectedAppointmentForNoShow.room.name}</span>
                </div>
              </div>
              
              <div className="mobile-dialog-warning">
              <p>⚠️ 标记爽约后，该病人将被扣除5分</p>
              </div>
            </div>
            
            <div className="mobile-dialog-actions">
              <button 
                onClick={closeNoShowDialog}
                className="mobile-dialog-cancel-btn"
                disabled={noShowLoading}
              >
                取消
              </button>
              <button 
                onClick={() => handleMarkNoShow(selectedAppointmentForNoShow.id)}
                className="mobile-dialog-confirm-btn"
                disabled={noShowLoading}
              >
                {noShowLoading ? '處理中...' : '確認標記'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 取消預約模態框 */}
      {showCancelDialog && (
        <CancelAppointmentModal
          isOpen={showCancelDialog}
          info={selectedAppointmentForCancel ? {
            patientName: selectedAppointmentForCancel.patient.user.name,
            credibilityScore: selectedAppointmentForCancel.patient.credibilityScore,
            date: selectedAppointmentForCancel.date,
            time: selectedAppointmentForCancel.time,
            roomName: selectedAppointmentForCancel.room.name,
          } : null}
          onClose={closeCancelDialog}
          onConfirm={confirmCancelAppointment}
          isProcessing={cancelLoading}
        />
      )}

      {/* 歷史記錄模態框 */}
      {showHistoryModal && selectedAppointmentId && (
        <AppointmentHistoryModal
          appointmentId={selectedAppointmentId}
          isOpen={showHistoryModal}
          onClose={closeHistoryModal}
        />
      )}
    </div>
  );
}
  const getNotificationTypeClass = (type: string): string => {
    if (type === 'APPOINTMENT_CANCELLED') return 'mobile-notification-cancelled';
    if (type === 'APPOINTMENT_CREATED') return 'mobile-notification-appointment';
    if (type === 'APPOINTMENT_STATUS_UPDATED') return 'mobile-notification-status';
    if (type === 'TIMESLOT_CREATED' || type === 'TIMESLOT_UPDATED' || type === 'TIMESLOT_DELETED') return 'mobile-notification-timeslot';
    if (type === 'SCHEDULE_CREATED' || type === 'SCHEDULE_UPDATED' || type === 'SCHEDULE_DELETED') return 'mobile-notification-schedule';
    return 'mobile-notification-appointment';
  };

  const getNotificationItemClass = (type: string): string => {
    if (type === 'APPOINTMENT_CANCELLED') return 'mobile-notification-item-type-cancelled';
    if (type === 'APPOINTMENT_CREATED') return 'mobile-notification-item-type-appointment';
    if (type === 'APPOINTMENT_STATUS_UPDATED') return 'mobile-notification-item-type-status';
    if (type === 'TIMESLOT_CREATED' || type === 'TIMESLOT_UPDATED' || type === 'TIMESLOT_DELETED') return 'mobile-notification-item-type-timeslot';
    if (type === 'SCHEDULE_CREATED' || type === 'SCHEDULE_UPDATED' || type === 'SCHEDULE_DELETED') return 'mobile-notification-item-type-schedule';
    return '';
  };

  const getNotificationLabel = (type: string): string => {
    if (type === 'APPOINTMENT_CANCELLED') return '预约已取消';
    if (type === 'APPOINTMENT_CREATED') return '新预约提醒';
    if (type === 'APPOINTMENT_STATUS_UPDATED') return '预约状态变更';
    if (type === 'TIMESLOT_CREATED') return '新增时段';
    if (type === 'TIMESLOT_UPDATED') return '时段已更新';
    if (type === 'TIMESLOT_DELETED') return '时段已删除';
    if (type === 'SCHEDULE_CREATED') return '排班已创建';
    if (type === 'SCHEDULE_UPDATED') return '排班已更新';
    if (type === 'SCHEDULE_DELETED') return '排班已删除';
    return '预约通知';
  };
