'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FaTimes, FaCheckCircle, FaBell, FaHistory, FaTrash, FaPen, FaPlus } from 'react-icons/fa';
import './mobile.css';
import { getStatusText } from '../../../utils/statusText';
import { fetchWithTimeout } from '../../../utils/network';
import EnhancedDatePicker, { DateStatus } from '../../../components/EnhancedDatePicker';
import AppointmentHistoryModal from '../../../components/AppointmentHistoryModal';
import CancelAppointmentModal from '../../../components/CancelAppointmentModal';
import PatientDetailModal from '../../../components/PatientDetailModal';
import PatientEditModal, {
  EditablePatientData,
  PatientEditPayload,
} from '../../../components/PatientEditModal';

// --- Interfaces ---
interface PatientListItem {
  id: string;
  username?: string | null;
  name: string;
  gender: string | null;
  dateOfBirth?: string | null;
  age: number | null;
  phone: string | null;
  socialSecurityNumber?: string | null;
  credibilityScore: number;
  visitCount: number;
  noShowCount: number;
  totalAppointments: number;
}

type PatientSortOption =
  | 'latest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'score_desc'
  | 'score_asc'
  | 'age_desc'
  | 'age_asc';

const PATIENTS_PAGE_SIZE = 50;
const PATIENT_SORT_OPTIONS: Array<{ value: PatientSortOption; label: string }> = [
  { value: 'latest', label: '最新建档' },
  { value: 'oldest', label: '最早建档' },
  { value: 'name_asc', label: '姓名 A-Z' },
  { value: 'name_desc', label: '姓名 Z-A' },
  { value: 'score_desc', label: '积分从高到低' },
  { value: 'score_asc', label: '积分从低到高' },
  { value: 'age_desc', label: '年龄从大到小' },
  { value: 'age_asc', label: '年龄从小到大' },
];

const CREATE_PATIENT_TEMPLATE: EditablePatientData = {
  id: '',
  username: null,
  name: '',
  gender: null,
  dateOfBirth: '',
  age: null,
  phone: '13930555555',
  socialSecurityNumber: '',
  credibilityScore: 15,
  visitCount: 0,
  noShowCount: 0,
  totalAppointments: 0,
};

interface Patient {
  id: string;
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
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

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
  const dateInputRef = useRef<HTMLInputElement>(null);

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

  // --- Patient List States ---
  const [activeTab, setActiveTab] = useState<'appointments' | 'patients'>('appointments');
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientTotal, setPatientTotal] = useState(0);
  const [patientPage, setPatientPage] = useState(1);
  const [patientSort, setPatientSort] = useState<PatientSortOption>('name_asc');
  const [selectedPatient, setSelectedPatient] = useState<PatientListItem | null>(null);
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showEditPatientModal, setShowEditPatientModal] = useState(false);
  const [selectedPatientForEdit, setSelectedPatientForEdit] = useState<EditablePatientData | null>(null);
  const [editPatientLoading, setEditPatientLoading] = useState(false);
  const [showCreatePatientModal, setShowCreatePatientModal] = useState(false);
  const [createPatientLoading, setCreatePatientLoading] = useState(false);
  const [showDeletePatientDialog, setShowDeletePatientDialog] = useState(false);
  const [selectedPatientForDelete, setSelectedPatientForDelete] = useState<PatientListItem | null>(null);
  const [deletePatientLoading, setDeletePatientLoading] = useState(false);
  
  // --- Filter Modal States ---
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [tempStatus, setTempStatus] = useState(selectedStatus);
  const [tempRoomId, setTempRoomId] = useState(selectedRoomId);
  const [tempDate, setTempDate] = useState(selectedDate);

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session?.user?.role !== 'DOCTOR') {
      setError('访问被拒绝');
    }
  }, [status, session?.user?.role, router]);

  useEffect(() => {
    const hasCookie = (name: string) => document.cookie.split(';').some(c => c.trim().startsWith(name + '='));
    
    if (hasCookie('doc_apt_status')) {
      const s = getCookie('doc_apt_status');
      setSelectedStatus(s);
      setTempStatus(s);
    }
    if (hasCookie('doc_apt_room')) {
      const r = getCookie('doc_apt_room');
      setSelectedRoomId(r);
      setTempRoomId(r);
    }
    if (hasCookie('doc_apt_date')) {
      const d = getCookie('doc_apt_date');
      setSelectedDate(d);
      setTempDate(d);
    }
  }, []);

  useEffect(() => { setCookie('doc_apt_status', selectedStatus || ''); }, [selectedStatus]);
  useEffect(() => { setCookie('doc_apt_room', selectedRoomId || ''); }, [selectedRoomId]);
  useEffect(() => { setCookie('doc_apt_date', selectedDate || ''); }, [selectedDate]);

  // 獲取通知數據（僅在醫生身份下觸發，並對 401/404 友好處理）
  // 提取為獨立函數，供初始化與 SSE 事件刷新使用
  const fetchNotifications = async () => {
    try {
      const res = await fetchWithTimeout('/api/notifications');
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

      // 計算未讀總數
      const allUnread = allNotifications.filter((n: Notification) => !n.isRead);
      setTotalUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : allUnread.length);

      // 只顯示最近的未讀通知（最多5條）
      setUnreadNotifications(allUnread.slice(0, 5));
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
      const appointmentsRes = await fetchWithTimeout('/api/appointments');
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
        const profileRes = await fetchWithTimeout('/api/user');
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
                  const res = await fetchWithTimeout(`/api/appointments/${appointmentId}`);
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
                  const res = await fetchWithTimeout(`/api/appointments/${appointmentId}`);
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
                  const res = await fetchWithTimeout(`/api/appointments/${appointmentId}`);
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
    if (error) setOverlayText(error);
  }, [error]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const aptRes = await fetchWithTimeout('/api/appointments', { cache: 'no-store' });
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
        const notifRes = await fetchWithTimeout('/api/notifications', { cache: 'no-store' });
        if (notifRes.ok) {
          const notifData = await notifRes.json();
          const all = notifData.notifications || [];
          const allUnread = all.filter((n: Notification) => !n.isRead);
          const unreadCount = typeof notifData.unreadCount === 'number' ? notifData.unreadCount : allUnread.length;
          
          if (snapshotRef.current.unread !== unreadCount) {
            setNotifications(all);
            setTotalUnreadCount(unreadCount);
            setUnreadNotifications(allUnread.slice(0, 5));
            snapshotRef.current.unread = unreadCount;
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

  const appointmentDates = useMemo(() => {
    const dates = new Set(appointments.map(a => a.date));
    return Array.from(dates).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  }, [appointments]);

  const dateStatuses = useMemo(() => {
    const map = new Map<string, DateStatus>();
    appointments.forEach(apt => {
      const d = apt.date;
      const today = new Date();
      today.setHours(0,0,0,0);
      const aptDate = new Date(d);
      const isPast = aptDate < today;
      
      if (!map.has(d)) {
        map.set(d, {
          date: d,
          hasSchedule: true,
          hasAppointments: true,
          bookedBeds: 0,
          totalBeds: 0,
          isPast
        });
      }
      const s = map.get(d)!;
      s.bookedBeds += 1;
      s.totalBeds += 1;
    });
    return Array.from(map.values());
  }, [appointments]);

  // --- Handlers ---
  // 標記通知為已讀
  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const res = await fetchWithTimeout('/api/notifications', {
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
      setTotalUnreadCount(prev => Math.max(0, prev - 1));
      
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
      const res = await fetchWithTimeout('/api/notifications', {
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
      setTotalUnreadCount(prev => Math.max(0, prev - unreadIds.length));
      
      // 觸發底部導航欄的未讀計數更新
      window.dispatchEvent(new CustomEvent('notificationRead'));
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const fetchPatients = async (page = 1, sort = patientSort) => {
    setPatientLoading(true);
    try {
      const res = await fetchWithTimeout(
        `/api/doctor/patients?page=${page}&limit=${PATIENTS_PAGE_SIZE}&sort=${sort}`
      );
      if (!res.ok) throw new Error('Failed to fetch patients');
      const data = await res.json();
      setPatients(data.patients);
      setPatientTotal(data.total);
    } catch (err) {
      console.error(err);
      setError('获取病人列表失败');
    } finally {
      setPatientLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'patients') {
      fetchPatients(patientPage, patientSort);
    }
  }, [activeTab, patientPage, patientSort]);

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
      const response = await fetchWithTimeout(`/api/appointments/${selectedAppointmentForCancel.id}`, {
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
    setSelectedDate('');
    setSelectedRoomId('');
    setSelectedStatus('');
    setCurrentPage(1);
  };

  const openFilterModal = () => {
    setTempStatus(selectedStatus);
    setTempRoomId(selectedRoomId);
    setTempDate(selectedDate);
    setShowFilterModal(true);
  };

  const applyFilters = () => {
    setSelectedStatus(tempStatus);
    setSelectedRoomId(tempRoomId);
    setSelectedDate(tempDate);
    setCurrentPage(1);
    setShowFilterModal(false);
  };

  const resetTempFilters = () => {
    setTempStatus('');
    setTempRoomId('');
    setTempDate('');
  };

  // 標記爽約
  const handleMarkNoShow = async (appointmentId: string) => {
    try {
      setNoShowLoading(true);
      const res = await fetchWithTimeout('/api/appointments/status', {
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

  const getGenderInfo = (gender?: string | null): { text: string; className: 'gender-male' | 'gender-female' | 'gender-other' } => {
    const g = (gender || '').toUpperCase();
    if (g === 'MALE' || g === 'M') return { text: '男', className: 'gender-male' };
    if (g === 'FEMALE' || g === 'F') return { text: '女', className: 'gender-female' };
    return { text: '未知', className: 'gender-other' };
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

  const handleSaveScore = async (patientId: string, newScore: number) => {
    try {
      const res = await fetchWithTimeout(`/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credibilityScore: newScore }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '更新积分失败');
      }

      // Update patients list state
      setPatients(prev => prev.map(p => 
        p.id === patientId ? { ...p, credibilityScore: newScore } : p
      ));
      
      // Update appointments state (as it also displays score)
      setAppointments(prev => prev.map(apt => 
        apt.patient.id === patientId 
          ? { ...apt, patient: { ...apt.patient, credibilityScore: newScore } } 
          : apt
      ));

      // Update selected patient state if it's the same patient
      if (selectedPatient && selectedPatient.id === patientId) {
          setSelectedPatient(prev => prev ? { ...prev, credibilityScore: newScore } : null);
      }

      setSuccess('病人积分已更新');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '更新积分失败');
      setTimeout(() => setError(null), 3000);
      throw err;
    }
  };

  const openEditPatientDialog = (patient: PatientListItem) => {
    setSelectedPatientForEdit(patient);
    setShowEditPatientModal(true);
  };

  const closeEditPatientDialog = () => {
    if (editPatientLoading) return;
    setShowEditPatientModal(false);
    setSelectedPatientForEdit(null);
  };

  const openCreatePatientDialog = () => {
    setShowCreatePatientModal(true);
  };

  const closeCreatePatientDialog = () => {
    if (createPatientLoading) return;
    setShowCreatePatientModal(false);
  };

  const handleEditPatientSave = async (
    patientId: string,
    payload: PatientEditPayload
  ) => {
    try {
      setEditPatientLoading(true);
      setError(null);

      const response = await fetchWithTimeout(`/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || '保存病人信息失败');
      }

      const updatedPatient = data.patient as PatientListItem | undefined;
      const passwordUpdated = Boolean(data.passwordUpdated);
      if (!updatedPatient) {
        throw new Error('病人信息已保存，但返回数据异常。');
      }

      setPatients((prev) =>
        prev.map((patient) => (patient.id === patientId ? { ...patient, ...updatedPatient } : patient))
      );

      setAppointments((prev) =>
        prev.map((appointment) =>
          appointment.patient.id === patientId
            ? {
                ...appointment,
                patient: {
                  ...appointment.patient,
                  user: {
                    ...appointment.patient.user,
                    name: updatedPatient.name,
                    phone: updatedPatient.phone || undefined,
                    gender: updatedPatient.gender || undefined,
                    dateOfBirth: updatedPatient.dateOfBirth || undefined,
                  },
                },
              }
            : appointment
        )
      );

      if (selectedPatient?.id === patientId) {
        setSelectedPatient((prev) => (prev ? { ...prev, ...updatedPatient } : null));
      }

      setSelectedPatientForEdit(updatedPatient);
      setShowEditPatientModal(false);
      if (patientSort !== 'latest') {
        await fetchPatients(patientPage, patientSort);
      }
      setSuccess(
        passwordUpdated
          ? `已更新 ${updatedPatient.name} 的病人信息，并修改密码`
          : `已更新 ${updatedPatient.name} 的病人信息`
      );
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '保存病人信息失败');
      setTimeout(() => setError(null), 3000);
      throw err;
    } finally {
      setEditPatientLoading(false);
    }
  };

  const openDeletePatientDialog = (patient: PatientListItem) => {
    setSelectedPatientForDelete(patient);
    setShowDeletePatientDialog(true);
  };

  const closeDeletePatientDialog = (force = false) => {
    if (deletePatientLoading && !force) return;
    setShowDeletePatientDialog(false);
    setSelectedPatientForDelete(null);
  };

  const handleDeletePatient = async () => {
    if (!selectedPatientForDelete) return;

    const patientId = selectedPatientForDelete.id;
    const patientName = selectedPatientForDelete.name;

    try {
      setDeletePatientLoading(true);
      setError(null);

      const response = await fetchWithTimeout(`/api/patients/${patientId}`, {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || '删除病人失败');
      }

      setPatients(prev => prev.filter(patient => patient.id !== patientId));
      setAppointments(prev => prev.filter(appointment => appointment.patient.id !== patientId));

      if (selectedPatient?.id === patientId) {
        setSelectedPatient(null);
        setShowPatientModal(false);
      }

      const nextTotal = Math.max(0, patientTotal - 1);
      const nextPage = Math.min(patientPage, Math.max(1, Math.ceil(nextTotal / PATIENTS_PAGE_SIZE)));

      setPatientTotal(nextTotal);
      closeDeletePatientDialog(true);
      setSuccess(data.message || `已删除病人 ${patientName}`);
      setTimeout(() => setSuccess(null), 3000);

      if (nextPage !== patientPage) {
        setPatientPage(nextPage);
      } else {
        await fetchPatients(nextPage);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '删除病人失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setDeletePatientLoading(false);
    }
  };

  const handleCreatePatientSave = async (
    _patientId: string,
    payload: PatientEditPayload
  ) => {
    try {
      setCreatePatientLoading(true);
      setError(null);

      const response = await fetchWithTimeout('/api/doctor/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || '创建病人失败');
      }

      const createdPatient = data.patient as PatientListItem | undefined;
      if (!createdPatient) {
        throw new Error('病人已创建，但返回数据异常。');
      }

      setPatientTotal((prev) => prev + 1);
      if (patientSort === 'latest' && patientPage === 1) {
        setPatients((prev) => [createdPatient, ...prev].slice(0, PATIENTS_PAGE_SIZE));
      } else if (patientSort === 'latest' && patientPage !== 1) {
        setPatientPage(1);
      } else {
        await fetchPatients(patientPage, patientSort);
      }

      setShowCreatePatientModal(false);
      setSuccess(
        `已创建病人 ${createdPatient.name}，用户名是 ${createdPatient.username}，默认密码是 ${data.defaultPassword || '123456'}`
      );
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '创建病人失败');
      setTimeout(() => setError(null), 3000);
      throw err;
    } finally {
      setCreatePatientLoading(false);
    }
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
      {/* 通知區域 */}
      {unreadNotifications.length > 0 && (
        <div className="mobile-notifications-banner">
          <div className="mobile-notifications-header">
            <div className="mobile-notifications-title">
              <FaBell className="mobile-notifications-icon" />
              <span>新通知 ({totalUnreadCount})</span>
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

      {/* Tabs */}
      <div className="flex w-full mb-6 bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
        <button
          onClick={() => setActiveTab('appointments')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative
            ${activeTab === 'appointments'
              ? 'bg-blue-50 text-blue-600 font-semibold'
              : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
        >
          <div className="flex items-center justify-center gap-1">
            <span>预约列表</span>
          </div>
          {activeTab === 'appointments' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"></div>
          )}
        </button>
        <button
          onClick={() => setActiveTab('patients')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative
            ${activeTab === 'patients'
              ? 'bg-blue-50 text-blue-600 font-semibold'
              : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
        >
          <div className="flex items-center justify-center gap-1">
            <span>病人列表</span>
          </div>
          {activeTab === 'patients' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"></div>
          )}
        </button>
      </div>

      {/* Filters */}
      {/* Filters */}
      {activeTab === 'appointments' && (
        <>
      <div className="mb-4 w-full">
        <button
          onClick={openFilterModal}
          className="w-full bg-white text-gray-700 font-medium py-3 px-4 rounded-xl shadow-sm border border-gray-200 flex items-center justify-center gap-2 active:bg-gray-50 transition-colors"
        >
          <span className="text-lg">🔍</span>
          <span>筛选预约 ({[
            selectedStatus ? '已选状态' : null, 
            selectedRoomId ? '已选诊室' : null, 
            selectedDate ? '已选日期' : null
          ].filter(Boolean).length > 0 ? 
            [selectedStatus && '状态', selectedRoomId && '诊室', selectedDate && '日期'].filter(Boolean).join(' · ') 
            : '全部'})</span>
        </button>
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
              {error ? (
                <div className="text-center py-8">
                  <p className="text-red-600 mb-4">{error}</p>
                  <button 
                    onClick={() => fetchAppointments()} 
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                  >
                    重试加载
                  </button>
                </div>
              ) : (
                <p className="mobile-empty-text">
                  {appointments.length === 0 ? '暂无预约记录' : '没有符合条件的预约记录'}
                </p>
              )}
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
      </>
      )}

      {activeTab === 'patients' && (
        <div className="mobile-content-card">
          <div className="mb-4 flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">病人管理</h2>
              <p className="mt-1 text-sm text-gray-500">
                共 {patientTotal} 位病人，可手填建档，也可扫描社保卡快速创建
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 shadow-sm">
                <span className="shrink-0 font-medium text-gray-700">排序</span>
                <select
                  value={patientSort}
                  onChange={(event) => {
                    const nextSort = event.target.value as PatientSortOption;
                    setPatientSort(nextSort);
                    setPatientPage(1);
                  }}
                  className="min-w-[9rem] bg-transparent text-sm font-medium text-gray-900 outline-none"
                >
                  {PATIENT_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={openCreatePatientDialog}
                disabled={createPatientLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                <FaPlus className="text-xs" />
                {createPatientLoading ? '创建中...' : '添加病人'}
              </button>
            </div>
          </div>

          <div className="relative min-h-[34rem] overflow-x-auto">
            <table className="w-full table-fixed text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="w-[6.25rem] p-3 text-xs font-medium text-gray-500 uppercase tracking-wider sm:w-[7rem]">姓名</th>
                  <th className="hidden w-[5rem] p-3 text-xs font-medium text-gray-500 uppercase tracking-wider sm:table-cell">性别</th>
                  <th className="hidden w-[5rem] p-3 text-xs font-medium text-gray-500 uppercase tracking-wider sm:table-cell">年龄</th>
                  <th className="w-[4.25rem] p-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider sm:w-[4.75rem]">积分</th>
                  <th className="hidden w-[5rem] p-3 text-xs font-medium text-gray-500 uppercase tracking-wider sm:table-cell">爽约</th>
                  <th className="w-[8.5rem] p-3 text-xs font-medium text-gray-500 uppercase tracking-wider sm:w-[9.5rem]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {patients.length === 0 ? (
                  patientLoading ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        加载中...
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        暂无病人记录
                      </td>
                    </tr>
                  )
                ) : (
                  patients.map((patient) => (
                    <tr 
                      key={patient.id} 
                      onClick={() => { setSelectedPatient(patient); setShowPatientModal(true); }}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="p-3">
                        <div
                          className="truncate font-medium text-gray-900"
                          title={patient.name}
                        >
                          {patient.name}
                        </div>
                        <div className="truncate text-xs text-gray-500 sm:hidden">
                          {getGenderInfo(patient.gender).text} · {patient.age ? `${patient.age}岁` : '未知'}
                        </div>
                      </td>
                      <td className="hidden p-3 sm:table-cell">
                        {(() => {
                          const g = getGenderInfo(patient.gender);
                          const colorClass = g.className === 'gender-male' ? 'bg-blue-100 text-blue-800' : 
                                             g.className === 'gender-female' ? 'bg-pink-100 text-pink-800' : 'bg-gray-100 text-gray-800';
                          return (
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                              {g.text}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="hidden p-3 sm:table-cell text-gray-600">
                        {patient.age ? `${patient.age}岁` : '-'}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`font-semibold ${patient.credibilityScore < 60 ? 'text-red-600' : 'text-green-600'}`}>
                          {patient.credibilityScore}
                        </span>
                      </td>
                      <td className="hidden p-3 sm:table-cell text-red-600 font-medium">
                        {patient.noShowCount} 次
                      </td>
                      <td className="p-3">
                        <div className="flex flex-row flex-nowrap items-center gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditPatientDialog(patient);
                            }}
                            disabled={editPatientLoading && selectedPatientForEdit?.id === patient.id}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <FaPen className="text-[0.7rem]" />
                            {editPatientLoading && selectedPatientForEdit?.id === patient.id ? '保存中' : '编辑'}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openDeletePatientDialog(patient);
                            }}
                            disabled={deletePatientLoading && selectedPatientForDelete?.id === patient.id}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <FaTrash className="text-[0.7rem]" />
                            {deletePatientLoading && selectedPatientForDelete?.id === patient.id ? '删除中' : '删除'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {patientLoading && patients.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/75 backdrop-blur-[1px]">
                <div className="rounded-full bg-white px-5 py-3 text-sm font-medium text-gray-600 shadow-sm">
                  加载中...
                </div>
              </div>
            )}
          </div>
          
          {/* Patient Pagination */}
          {Math.ceil(patientTotal / PATIENTS_PAGE_SIZE) > 1 && (
            <div className="mobile-pagination">
              <button
                onClick={() => setPatientPage(prev => Math.max(prev - 1, 1))}
                disabled={patientPage === 1 || patientLoading}
                className="mobile-pagination-btn"
              >
                上一页
              </button>
              <span className="mobile-pagination-info">
                第 {patientPage} 页，共 {Math.ceil(patientTotal / PATIENTS_PAGE_SIZE)} 页
              </span>
              <button
                onClick={() => setPatientPage(prev => Math.min(prev + 1, Math.ceil(patientTotal / PATIENTS_PAGE_SIZE)))}
                disabled={patientPage >= Math.ceil(patientTotal / PATIENTS_PAGE_SIZE) || patientLoading}
                className="mobile-pagination-btn"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}

      {/* 筛选模态框 */}
      {showFilterModal && (
        <div className="mobile-dialog-overlay">
          <div className="mobile-dialog">
            <div className="mobile-dialog-header">
              <h3 className="mobile-dialog-title">筛选预约</h3>
              <button 
                onClick={resetTempFilters}
                className="text-sm text-blue-600 font-medium"
              >
                重置
              </button>
            </div>
            
            <div className="mobile-dialog-content">
              {/* Status Pills */}
              <div className="mb-4">
                <label className="mobile-filter-label block mb-2">状态</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: '', label: '全部' },
                    { value: 'PENDING', label: '待就诊' },
                    { value: 'COMPLETED', label: '已完成' },
                    { value: 'CANCELLED', label: '已取消' },
                    { value: 'NO_SHOW', label: '未到诊' }
                  ].map((statusOption) => (
                    <button
                      key={statusOption.value}
                      onClick={() => {
                         const next = statusOption.value;
                         setTempStatus(next);
                         if (next) setTempDate('');
                      }}
                      className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                        tempStatus === statusOption.value
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {statusOption.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Room Filter */}
              <div className="mb-4">
                <label className="mobile-filter-label block mb-2">诊室</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setTempRoomId('')}
                    className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                      tempRoomId === ''
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    全部
                  </button>
                  {doctorProfile?.Room.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setTempRoomId(room.id)}
                      className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                        tempRoomId === room.id
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {room.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date Filter */}
              <div className="mb-4">
                <label className="mobile-filter-label block mb-2">日期</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setTempDate('')}
                    className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                      tempDate === ''
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    全部
                  </button>
                  <button
                    onClick={() => setShowDatePicker(true)}
                    className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                      tempDate !== ''
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {tempDate || '选择日期'}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="mobile-dialog-actions">
              <button 
                onClick={() => setShowFilterModal(false)}
                className="mobile-dialog-cancel-btn"
              >
                取消
              </button>
              <button 
                onClick={applyFilters}
                className="mobile-dialog-primary-btn"
              >
                应用筛选
              </button>
            </div>
          </div>
        </div>
      )}

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

      {showDeletePatientDialog && selectedPatientForDelete && (
        <div className="mobile-dialog-overlay">
          <div className="mobile-dialog">
            <div className="mobile-dialog-header">
              <h3 className="mobile-dialog-title">确认删除病人</h3>
              <button
                onClick={() => closeDeletePatientDialog()}
                className="mobile-dialog-close"
                disabled={deletePatientLoading}
              >
                <FaTimes />
              </button>
            </div>

            <div className="mobile-dialog-content">
              <p className="mobile-dialog-message">
                删除后将同时移除该病人的账号、关联预约、通知与登录信息，且无法恢复。
              </p>

              <div className="mobile-dialog-appointment-info">
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">病人：</span>
                  <span className="mobile-dialog-value">{selectedPatientForDelete.name}</span>
                </div>
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">电话：</span>
                  <span className="mobile-dialog-value">{selectedPatientForDelete.phone || '-'}</span>
                </div>
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">性别：</span>
                  <span className="mobile-dialog-value">{getGenderInfo(selectedPatientForDelete.gender).text}</span>
                </div>
                <div className="mobile-dialog-info-row">
                  <span className="mobile-dialog-label">关联预约：</span>
                  <span className="mobile-dialog-value">{selectedPatientForDelete.totalAppointments} 条</span>
                </div>
              </div>

              <div className="mobile-dialog-warning">
                <p>建议仅删除确认重复、后续准备重新补录社保号的病人记录。</p>
              </div>
            </div>

            <div className="mobile-dialog-actions">
              <button
                onClick={() => closeDeletePatientDialog()}
                className="mobile-dialog-cancel-btn"
                disabled={deletePatientLoading}
              >
                取消
              </button>
              <button
                onClick={handleDeletePatient}
                className="mobile-dialog-confirm-btn"
                disabled={deletePatientLoading}
              >
                {deletePatientLoading ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PatientEditModal
        isOpen={showCreatePatientModal}
        patient={CREATE_PATIENT_TEMPLATE}
        isSaving={createPatientLoading}
        mode="create"
        requireSocialSecurityNumber
        onClose={closeCreatePatientDialog}
        onSave={handleCreatePatientSave}
      />

      <PatientEditModal
        isOpen={showEditPatientModal}
        patient={selectedPatientForEdit}
        isSaving={editPatientLoading}
        mode="edit"
        onClose={closeEditPatientDialog}
        onSave={handleEditPatientSave}
      />

      {/* Patient Detail Modal */}
      <PatientDetailModal
        isOpen={showPatientModal}
        onClose={() => setShowPatientModal(false)}
        patient={selectedPatient}
        appointments={appointments.filter(a => a.patient?.id === selectedPatient?.id)}
        onSave={handleSaveScore}
      />

      {/* Date Picker Dialog */}
      {showDatePicker && (
        <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-md mx-4 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">选择日期</h3>
              <button onClick={() => setShowDatePicker(false)} className="text-gray-500 hover:text-gray-700">
                <FaTimes />
              </button>
            </div>
            <EnhancedDatePicker
              selectedDate={showFilterModal ? (tempDate ? new Date(tempDate) : new Date()) : (selectedDate ? new Date(selectedDate) : new Date())}
              onDateChange={(date) => {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                const dateStr = `${y}-${m}-${d}`;
                
                if (showFilterModal) {
                  setTempDate(dateStr);
                } else {
                  setSelectedDate(dateStr);
                  setCurrentPage(1);
                }
                setShowDatePicker(false);
              }}
              dateStatuses={dateStatuses}
              isLoading={isLoading}
            />
          </div>
        </div>
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
