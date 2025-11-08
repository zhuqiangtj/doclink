'use client';

import { useState, useEffect, useMemo } from 'react';
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
  doctor: { name: string };
  room: { name: string };
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

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated' && session.user.role !== 'PATIENT') {
      router.push('/');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status === 'authenticated') {
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
      fetchAppointments();
    }
  }, [status]);

  const handleCancel = async (appointmentId: string) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('取消预约失败');
      
      // 重新获取预约列表
      const appointmentsRes = await fetch('/api/appointments');
      if (appointmentsRes.ok) {
        const data = await appointmentsRes.json();
        setAppointments(data);
      }
    } catch (error) {
      setError('取消预约失败，请稍后再试');
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
      const statusMatch = !selectedStatus || apt.status === selectedStatus;
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

  const resetFilters = () => {
    setSelectedDate('');
    setSelectedRoomName('');
    setSelectedStatus('PENDING');
  };

  if (isLoading || status === 'loading') {
    return <div className="mobile-loading">正在加载预约...</div>;
  }

  return (
    <div className="mobile-container">
      <h1 className="mobile-header">我的预约</h1>
      {error && <div className="mobile-alert mobile-alert-error">{error}</div>}
      {success && <div className="mobile-alert mobile-alert-success">{success}</div>}

      {/* 過濾器 */}
      <div className="mobile-filters-card">
        <h2 className="mobile-filters-title">过滤器</h2>
        <div className="mobile-filters-grid">
          <div className="mobile-filter-group">
            <label htmlFor="date-filter" className="mobile-filter-label">日期</label>
            <input
              id="date-filter"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="mobile-filter-input"
            />
          </div>

          <div className="mobile-filter-group">
            <label htmlFor="room-filter" className="mobile-filter-label">诊室</label>
            <select
              id="room-filter"
              value={selectedRoomName}
              onChange={(e) => setSelectedRoomName(e.target.value)}
              className="mobile-filter-select"
            >
              <option value="">所有诊室</option>
              {uniqueRoomNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="mobile-filter-group">
            <label htmlFor="status-filter" className="mobile-filter-label">状态</label>
            <select
              id="status-filter"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="mobile-filter-select"
            >
              <option value="">所有状态</option>
              <option value="PENDING">待就诊</option>
              <option value="COMPLETED">已完成</option>
              <option value="CANCELLED">已取消</option>
              <option value="NO_SHOW">未到诊</option>
            </select>
          </div>

          {/* 排序選項已移除 */}
        </div>

        <div className="mobile-filters-actions">
          <button onClick={resetFilters} className="mobile-reset-filters-btn">重置过滤器</button>
          <span className="mobile-results-count">共 {filteredAppointments.length} 条记录</span>
        </div>
      </div>

      <div className="mobile-appointments-grid">
        {paginatedAppointments.length > 0 ? paginatedAppointments.map(apt => (
          <div key={apt.id} className="mobile-appointment-card">
            <div className="mobile-doctor-name">医生 {apt.doctor.name}</div>
            <div className="mobile-appointment-detail">
              <strong>日期：</strong>{new Date(apt.date).toLocaleDateString()}
            </div>
            <div className="mobile-appointment-detail">
              <strong>时间：</strong>{apt.time}
            </div>
            <div className="mobile-appointment-detail">
              <strong>地点：</strong>{apt.room.name}
            </div>
            {apt.reason && (
              <div className="mobile-appointment-detail">
                <strong>原因：</strong>{apt.reason}
              </div>
            )}
            <div className={`mobile-status ${
              apt.status === 'PENDING' ? 'mobile-status-pending' :
              apt.status === 'COMPLETED' ? 'mobile-status-completed' :
              apt.status === 'CANCELLED' ? 'mobile-status-cancelled' :
              'mobile-status-no-show'
            }`}>
              状态：{getStatusText(apt.status)}
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