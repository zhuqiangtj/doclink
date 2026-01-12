'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FaHistory } from 'react-icons/fa';
import './mobile.css';
import AppointmentHistoryModal from '../../components/AppointmentHistoryModal';
import { getStatusText } from '../../utils/statusText';

// --- Interfaces ---
interface Appointment {
  id: string;
  date: string;
  time: string;
  status: string;
  reason?: string; // 添加原因字段
  doctor: { user: { name: string } };
  room: { name: string };
  createTime: string;
  statusOperatedAt?: string;
}

// 狀態文字由統一工具提供

// --- Component ---
export default function MyAppointmentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, ] = useState<string | null>(null);
  
  // --- Filter States ---
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedRoomName, setSelectedRoomName] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('PENDING'); // 默認待就診
  
  // --- Pagination State ---
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 10;
  
  // --- History Modal States ---
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const snapshotRef = useRef<Map<string, string>>(new Map());
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
    for (let p of parts) {
      const c = p.trim();
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
    }
    return '';
  };

  // 獨立的獲取預約函數，供初始化與 SSE 事件後刷新使用
  const fetchAppointments = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/appointments');
      if (!res.ok) throw new Error('获取预约失败。');
      const data = await res.json();
      setAppointments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated' && session.user.role !== 'PATIENT') {
      router.push('/');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchAppointments();
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
        // 靜默失敗，不影響主要頁面渲染
      }
    })();
  }, [status]);

  // SSE：订阅患者频道的预约事件，自动刷新列表
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!patientId) return;
    try {
      const es = new EventSource(`/api/realtime/subscribe?kind=patient&id=${patientId}`);
      es.onmessage = async (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          const type = evt?.type as string | undefined;
          const raw = evt?.payload as unknown;
          const payload = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
          switch (type) {
            case 'APPOINTMENT_CREATED': {
              const appointmentId = typeof payload['appointmentId'] === 'string' ? (payload['appointmentId'] as string) : undefined;
              if (appointmentId) {
                try {
                  const res = await fetch(`/api/appointments/${appointmentId}`);
                  if (res.ok) {
                    const item = await res.json();
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
              const appointmentId = typeof payload['appointmentId'] === 'string' ? (payload['appointmentId'] as string) : undefined;
              if (appointmentId) {
                setAppointments(prev => prev.filter(a => a.id !== appointmentId));
              }
              setOverlayText('取消预约已同步');
              break;
            }
            case 'APPOINTMENT_STATUS_UPDATED': {
              const appointmentId = typeof payload['appointmentId'] === 'string' ? (payload['appointmentId'] as string) : undefined;
              const newStatus = typeof payload['newStatus'] === 'string' ? (payload['newStatus'] as string) : undefined;
              const reason = typeof payload['reason'] === 'string' ? (payload['reason'] as string) : undefined;
              if (appointmentId && newStatus) {
                try {
                  const res = await fetch(`/api/appointments/${appointmentId}`);
                  if (res.ok) {
                    const item = await res.json();
                    setAppointments(prev => prev.map(a => (a.id === item.id ? item : a)));
                  } else {
                    setAppointments(prev => prev.map(a => (a.id === appointmentId ? { ...a, status: newStatus, reason, statusOperatedAt: new Date().toISOString() } : a)));
                  }
                } catch {
                  setAppointments(prev => prev.map(a => (a.id === appointmentId ? { ...a, status: newStatus, reason, statusOperatedAt: new Date().toISOString() } : a)));
                }
              }
              setOverlayText('预约状态已同步');
              break;
            }
            default:
              break;
          }
        } catch {}
      };
      es.onerror = () => {
        // EventSource 自动重连
      };
      return () => es.close();
    } catch (err) {
      console.error('SSE subscribe (my appointments) failed:', err);
    }
  }, [status, patientId]);

  useEffect(() => {
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const res = await fetch('/api/appointments', { cache: 'no-store' });
        if (!res.ok) return;
        const data: Appointment[] = await res.json();
        const snap = new Map<string, string>();
        data.forEach(a => { snap.set(a.id, `${a.status}|${a.date}|${a.time}|${a.room?.name || ''}`); });
        let changed = false;
        const prev = snapshotRef.current;
        if (prev.size !== snap.size) changed = true;
        if (!changed) {
          for (const [id, val] of snap.entries()) {
            if (prev.get(id) !== val) { changed = true; break; }
          }
        }
        snapshotRef.current = snap;
        if (changed) {
          setAppointments(data);
          setOverlayText('已自动更新');
        }
      } catch {}
    };
    timer = setInterval(run, 60000);
    return () => { if (timer) clearInterval(timer); };
  }, [status]);

  const handleCancel = async (appointmentId: string) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        let message = '取消预约失败';
        try {
          const bodyText = await res.text();
          if (bodyText) {
            try {
              const errData = JSON.parse(bodyText);
              message = (errData && errData.error) ? errData.error : bodyText;
            } catch {
              message = bodyText;
            }
          }
        } catch {}
        throw new Error(message);
      }
      
      // 重新获取预约列表
      const appointmentsRes = await fetch('/api/appointments');
      if (appointmentsRes.ok) {
        const data = await appointmentsRes.json();
        setAppointments(data);
      }
    } catch {
      setError('取消预约失败，请稍后再试');
      try {
        const appointmentsRes = await fetch('/api/appointments');
        if (appointmentsRes.ok) {
          const data = await appointmentsRes.json();
          setAppointments(data);
        }
      } catch {}
      setOverlayText('取消预约失败');
    }
  };

  // 顯示狀態統一使用工具函數

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

  // --- Filters Logic ---
  const uniqueRoomNames = useMemo(() => {
    const names = new Set<string>();
    appointments.forEach(a => { if (a.room?.name) names.add(a.room.name); });
    return Array.from(names);
  }, [appointments]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter(apt => {
      const dateMatch = !selectedDate || apt.date === selectedDate;
      const roomMatch = !selectedRoomName || apt.room?.name === selectedRoomName;
      const statusMatch = !selectedStatus || normalizeStatus(apt.status) === normalizeStatus(selectedStatus);
      return dateMatch && roomMatch && statusMatch;
    });
  }, [appointments, selectedDate, selectedRoomName, selectedStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredAppointments.length / itemsPerPage));
  const paginatedAppointments = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredAppointments.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredAppointments, currentPage]);

  // Reset to first page when filters or sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate, selectedRoomName, selectedStatus]);

  useEffect(() => {
    const s = getCookie('myapt_status');
    const r = getCookie('myapt_room');
    const d = getCookie('myapt_date');
    if (s) setSelectedStatus(s);
    if (r) setSelectedRoomName(r);
    if (d) setSelectedDate(d);
  }, []);

  useEffect(() => { setCookie('myapt_status', selectedStatus || ''); }, [selectedStatus]);
  useEffect(() => { setCookie('myapt_room', selectedRoomName || ''); }, [selectedRoomName]);
  useEffect(() => { setCookie('myapt_date', selectedDate || ''); }, [selectedDate]);

  const resetFilters = () => {
    setSelectedDate('');
    setSelectedRoomName('');
    setSelectedStatus('');
    setCurrentPage(1);
  };

  if (isLoading || status === 'loading') {
    return <div className="mobile-loading">正在加载预约...</div>;
  }

  return (
    <div className="mobile-container">
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      <h1 className="mobile-header">我的预约</h1>
      {error && <div className="mobile-alert mobile-alert-error">{error}</div>}
      {success && <div className="mobile-alert mobile-alert-success">{success}</div>}

      {/* Filters */}
      <div className="mb-6">
        {/* Status Filter */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: '', label: '全部' },
              { value: 'PENDING', label: '待就诊' },
              { value: 'COMPLETED', label: '已完成' },
              { value: 'CANCELLED', label: '已取消' },
              { value: 'NO_SHOW', label: '未到诊' },
            ].map((status) => (
              <button
                key={status.value}
                onClick={() => { setSelectedStatus(status.value); setCurrentPage(1); }}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                  selectedStatus === status.value
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>

        {/* Room Filter */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">诊室</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setSelectedRoomName(''); setCurrentPage(1); }}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                selectedRoomName === ''
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              全部
            </button>
            {uniqueRoomNames.map((name) => (
              <button
                key={name}
                onClick={() => { setSelectedRoomName(name); setCurrentPage(1); }}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                  selectedRoomName === name
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Date Filter */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">日期</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setSelectedDate(''); setCurrentPage(1); }}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                selectedDate === ''
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => {
                try {
                  dateInputRef.current?.showPicker();
                } catch {
                  dateInputRef.current?.click();
                }
              }}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                selectedDate !== ''
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {selectedDate || '选择日期'}
            </button>
            <input
              type="date"
              ref={dateInputRef}
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setCurrentPage(1);
              }}
              className="absolute opacity-0 w-0 h-0 pointer-events-none"
              style={{ visibility: 'hidden' }}
            />
          </div>
        </div>
        
        <div className="flex justify-between items-center mt-2">
          <button onClick={resetFilters} className="text-sm text-blue-600 hover:text-blue-800 font-medium">重置过滤器</button>
          <span className="text-xs text-gray-500">共 {filteredAppointments.length} 条记录</span>
        </div>
      </div>

      <div className="mobile-appointments-grid">
        {paginatedAppointments.length > 0 ? paginatedAppointments.map(apt => (
          <div key={apt.id} className={`mobile-appointment-card ${
            normalizeStatus(apt.status) === 'PENDING' ? 'status-pending' :
            normalizeStatus(apt.status) === 'COMPLETED' ? 'status-completed' :
            normalizeStatus(apt.status) === 'CANCELLED' ? 'status-cancelled' :
            'status-no-show'
          }`}>
            <div className="mobile-appointment-header">
              <div className="mobile-doctor-name">医生 {apt.doctor.user.name}</div>
              <span className={`mobile-status-badge ${
                normalizeStatus(apt.status) === 'PENDING' ? 'status-pending' :
                normalizeStatus(apt.status) === 'COMPLETED' ? 'status-completed' :
                normalizeStatus(apt.status) === 'CANCELLED' ? 'status-cancelled' :
                'status-no-show'
              }`}>
                {getStatusText(normalizeStatus(apt.status))}
              </span>
            </div>
            <div className="mobile-appointment-detail">
              <strong>目标日期：</strong>{new Date(apt.date).toLocaleDateString()}
            </div>
            <div className="mobile-appointment-detail">
              <strong>目标时间：</strong>{apt.time}
            </div>
            <div className="mobile-appointment-detail">
              <strong>操作时间：</strong>{new Date(apt.createTime).toLocaleString()}
            </div>
            {apt.status === 'CANCELLED' && apt.statusOperatedAt && (
              <div className="mobile-appointment-detail">
                <strong>取消时间：</strong>{new Date(apt.statusOperatedAt).toLocaleString()}
              </div>
            )}
            {apt.status === 'NO_SHOW' && apt.statusOperatedAt && (
              <div className="mobile-appointment-detail">
                <strong>爽约标记时间：</strong>{new Date(apt.statusOperatedAt).toLocaleString()}
              </div>
            )}
            <div className="mobile-appointment-detail">
              <strong>地点：</strong>{apt.room.name}
            </div>
            {apt.reason && (
              <div className="mobile-appointment-detail">
                <strong>原因：</strong>{apt.reason}
              </div>
            )}
            {apt.status === 'COMPLETED' && apt.statusOperatedAt && (
              <div className="mobile-appointment-detail">
                <strong>{apt.reason && (apt.reason.includes('系統') || apt.reason.includes('系统')) ? '系统自动完成时间' : '完成时间'}：</strong>{new Date(apt.statusOperatedAt).toLocaleString()}
              </div>
            )}
            
            
            <div className="mobile-appointment-actions">
              <button 
                onClick={() => openHistoryModal(apt.id)}
                className="mobile-history-btn"
                title="查看历史记录"
              >
                <FaHistory className="mr-1" />
                历史记录
              </button>
              
              {new Date(`${apt.date}T${apt.time}`) > new Date() && apt.status === 'PENDING' && (
                <button onClick={() => handleCancel(apt.id)} className="mobile-cancel-btn">
                  取消预约
                </button>
              )}
            </div>
          </div>
        )) : (
          <div className="mobile-empty-state">
            <div className="mobile-empty-icon">📅</div>
            <p className="mobile-empty-text">您没有预约。</p>
          </div>
        )}
      </div>

      {/* 分頁控制 */}
      {filteredAppointments.length > 0 && (
        <div className="mobile-pagination">
          <button
            className="mobile-pagination-btn"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >上一页</button>
          <span className="mobile-pagination-info">第 {currentPage} / {totalPages} 页</span>
          <button
            className="mobile-pagination-btn"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >下一页</button>
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
  const isKnownStatus = (s: string): s is 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' => {
    return s === 'PENDING' || s === 'COMPLETED' || s === 'CANCELLED' || s === 'NO_SHOW';
  };

  const normalizeStatus = (status: string): 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' => {
    if (isKnownStatus(status)) return status;
    if (status === 'CHECKED_IN' || status === 'CONFIRMED') return 'PENDING';
    return 'PENDING';
  };
