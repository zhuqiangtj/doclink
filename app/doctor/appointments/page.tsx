'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import './mobile.css';

// --- Interfaces ---
interface Patient {
  user: { name: string };
  birthDate?: string;
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
  patient: Patient;
  doctor: Doctor;
  room: Room;
  createTime: string;
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

  // --- Filter States ---
  const getCurrentDateInChina = () => {
    const now = new Date();
    // 轉換為中國時間 (UTC+8)
    const chinaTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    return chinaTime.toISOString().split('T')[0];
  };

  const [selectedDate, setSelectedDate] = useState<string>(getCurrentDateInChina());
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') {
      setError('訪問被拒絕');
    }
  }, [status, session, router]);

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
        const appointmentsRes = await fetch('/api/appointments');
        if (!appointmentsRes.ok) throw new Error('獲取預約失敗');
        const appointmentsData = await appointmentsRes.json();
        setAppointments(appointmentsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : '發生未知錯誤');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [status, session]);

  // --- Computed Values ---
  const filteredAppointments = useMemo(() => {
    return appointments.filter(apt => {
      const dateMatch = !selectedDate || apt.date === selectedDate;
      const roomMatch = !selectedRoomId || apt.room.id === selectedRoomId;
      const statusMatch = !selectedStatus || apt.status === selectedStatus;
      return dateMatch && roomMatch && statusMatch;
    });
  }, [appointments, selectedDate, selectedRoomId, selectedStatus]);

  const sortedAppointments = useMemo(() => {
    return [...filteredAppointments].sort((a, b) => {
      // Sort by date (newest first), then by time
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
  const handleCancelAppointment = async (appointmentId: string, patientName: string) => {
    if (!confirm(`確定要取消 ${patientName} 的預約嗎？`)) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments?appointmentId=${appointmentId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '取消預約失敗');
      }

      setAppointments(prev => prev.filter(apt => apt.id !== appointmentId));
      setSuccess(`已成功取消 ${patientName} 的預約`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : '取消預約失敗');
    }
  };

  const resetFilters = () => {
    setSelectedDate(getCurrentDateInChina());
    setSelectedRoomId('');
    setSelectedStatus('');
    setCurrentPage(1);
  };

  const calculateAge = (birthDate?: string): string => {
    if (!birthDate) return '未知';
    const today = new Date();
    const birth = new Date(birthDate);
    const age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      return `${age - 1}歲`;
    }
    return `${age}歲`;
  };

  const getStatusText = (status: string): string => {
    const statusMap: { [key: string]: string } = {
      'pending': '待就診',
      'CONFIRMED': '已確認',
      'CHECKED_IN': '已簽到',
      'COMPLETED': '已完成',
      'CANCELLED': '已取消',
      'NO_SHOW': '未到診'
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string): string => {
    const colorMap: { [key: string]: string } = {
      'pending': 'status-pending',
      'CONFIRMED': 'status-confirmed',
      'CHECKED_IN': 'status-checked-in',
      'COMPLETED': 'status-completed',
      'CANCELLED': 'status-cancelled',
      'NO_SHOW': 'status-no-show'
    };
    return colorMap[status] || 'status-default';
  };

  // --- Render Logic ---
  if (status === 'loading' || isLoading) {
    return <div className="mobile-loading">正在加載...</div>;
  }

  if (!session || session.user.role !== 'DOCTOR') {
    return (
      <div className="mobile-access-denied">
        <h1 className="mobile-access-title">訪問被拒絕</h1>
        <p className="mobile-access-message">{error || '您必須以醫生身份登錄才能查看此頁面。'}</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="mobile-header">預約管理</h1>
      <p className="mobile-description">管理您的所有病人預約信息</p>
      
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
            <label htmlFor="room-filter" className="mobile-filter-label">診室</label>
            <select
              id="room-filter"
              value={selectedRoomId}
              onChange={(e) => {
                setSelectedRoomId(e.target.value);
                setCurrentPage(1);
              }}
              className="mobile-filter-select"
            >
              <option value="">所有診室</option>
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
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="mobile-filter-select"
            >
              <option value="">所有狀態</option>
              <option value="pending">待就診</option>
              <option value="CONFIRMED">已確認</option>
              <option value="CHECKED_IN">已簽到</option>
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

      {/* Appointments List */}
      <div className="mobile-content-card">
        <div className="mobile-appointments-list">
          {paginatedAppointments.length > 0 ? paginatedAppointments.map(apt => (
            <div key={apt.id} className="mobile-appointment-card">
              <div className="mobile-appointment-header">
                <div className="mobile-patient-info">
                  <h3 className="mobile-patient-name">{apt.patient.user.name}</h3>
                  <span className="mobile-patient-age">
                    {calculateAge(apt.patient.birthDate)}
                  </span>
                </div>
                <span className={`mobile-status-badge ${getStatusColor(apt.status)}`}>
                  {getStatusText(apt.status)}
                </span>
              </div>
              
              <div className="mobile-appointment-details">
                <div className="mobile-detail-row">
                  <span className="mobile-detail-label">診室：</span>
                  <span className="mobile-detail-value">{apt.room.name}</span>
                </div>
                <div className="mobile-detail-row">
                  <span className="mobile-detail-label">日期：</span>
                  <span className="mobile-detail-value">{apt.date}</span>
                </div>
                <div className="mobile-detail-row">
                  <span className="mobile-detail-label">時間：</span>
                  <span className="mobile-detail-value">{apt.time}</span>
                </div>
              </div>

              {(apt.status === 'pending' || apt.status === 'CONFIRMED') && (
                <div className="mobile-appointment-actions">
                  <button 
                    onClick={() => handleCancelAppointment(apt.id, apt.patient.user.name)}
                    className="mobile-cancel-appointment-btn"
                  >
                    取消預約
                  </button>
                </div>
              )}
            </div>
          )) : (
            <div className="mobile-empty-state">
              <p className="mobile-empty-text">
                {appointments.length === 0 ? '暫無預約記錄' : '沒有符合條件的預約記錄'}
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
              上一頁
            </button>
            
            <span className="mobile-pagination-info">
              第 {currentPage} 頁，共 {totalPages} 頁
            </span>
            
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="mobile-pagination-btn"
            >
              下一頁
            </button>
          </div>
        )}
      </div>
    </div>
  );
}