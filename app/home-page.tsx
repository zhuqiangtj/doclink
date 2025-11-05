"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import EnhancedDatePicker, { DateStatus } from "../components/EnhancedDatePicker";
import "../components/EnhancedDatePicker.css";
import "./mobile.css";
import { fetchPublicDateStatusesForMonth } from "../utils/publicDateStatusUtils";

interface Doctor { id: string; name: string }
interface Appointment {
  id: string;
  scheduleId: string;
  timeSlotId?: string;
  date: string;
  time: string;
  status: string;
}
interface TimeSlot {
  id: string;
  startTime: string;
  endTime: string;
  bedCount: number;
  availableBeds: number;
  type: "MORNING" | "AFTERNOON";
  isActive: boolean;
  appointments?: Array<{ id: string }>; // from public API for counts
}
interface Schedule {
  id: string;
  date: string;
  room: { id: string; name: string };
  timeSlots: TimeSlot[];
}

const toYYYYMMDD = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export default function PatientScheduleHome() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateStatuses, setDateStatuses] = useState<DateStatus[]>([]);
  const [isCalendarLoading, setIsCalendarLoading] = useState<boolean>(false);

  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);
  const [isDayLoading, setIsDayLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [patientId, setPatientId] = useState<string | null>(null);
  const [myAppointmentsBySlot, setMyAppointmentsBySlot] = useState<Record<string, string>>({}); // timeSlotId -> appointmentId
  // 預約確認模態框狀態
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [confirmBookingData, setConfirmBookingData] = useState<{ slot: TimeSlot; schedule: Schedule } | null>(null);
  const [isConfirmSubmitting, setIsConfirmSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/signin");
      return;
    }
    if (session.user.role !== "PATIENT") {
      router.push("/doctor/schedule");
      return;
    }

    const init = async () => {
      try {
        const [doctorsRes, userRes, appointmentsRes] = await Promise.all([
          fetch("/api/public/doctors"),
          fetch(`/api/user/${session.user.id}`),
          fetch("/api/appointments"),
        ]);

        if (!doctorsRes.ok) throw new Error("获取医生列表失败。");
        const ds: Doctor[] = await doctorsRes.json();
        setDoctors(ds);
        // 默认选中首位医生（使用 doctor.id），并立即加载当月与当天数据
        if (!selectedDoctorId && ds.length > 0) {
          const firstId = ds[0].id;
          setSelectedDoctorId(firstId);
          await refreshCalendarStatuses(selectedDate, firstId);
          await refreshDayDetails(selectedDate, firstId);
        }

        if (!userRes.ok) throw new Error("获取用户资料失败。");
        const userData = await userRes.json();
        if (!userData.patientProfile) throw new Error("未找到患者资料。");
        setPatientId(userData.patientProfile.id);

        if (!appointmentsRes.ok) throw new Error("获取我的预约失败。");
        const appointments: Appointment[] = await appointmentsRes.json();
        const map: Record<string, string> = {};
        appointments.forEach((apt) => {
          if (apt.timeSlotId) map[apt.timeSlotId] = apt.id;
        });
        setMyAppointmentsBySlot(map);
      } catch (err) {
        setError(err instanceof Error ? err.message : "发生未知错误");
      }
    };
    init();
  }, [status, session, router]);

  const refreshCalendarStatuses = async (date: Date, doctorId: string) => {
    if (!doctorId) return;
    setIsCalendarLoading(true);
    try {
      const statuses = await fetchPublicDateStatusesForMonth(date.getFullYear(), date.getMonth(), doctorId);
      setDateStatuses(statuses);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCalendarLoading(false);
    }
  };

  const refreshDayDetails = async (date: Date, doctorId: string) => {
    if (!doctorId) return;
    setIsDayLoading(true);
    setError(null);
    try {
      const dateStr = toYYYYMMDD(date);
      const detailsRes = await fetch(`/api/public/schedules?doctorId=${doctorId}&date=${dateStr}`);
      if (!detailsRes.ok) throw new Error("获取当天排班详情失败。");
      const details: Schedule[] = await detailsRes.json();
      setSchedulesForSelectedDay(details);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发生未知错误");
    } finally {
      setIsDayLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDoctorId) {
      // 月份或医生变化时更新日历状态
      refreshCalendarStatuses(selectedDate, selectedDoctorId);
      // 日期变化时更新当天详情
      refreshDayDetails(selectedDate, selectedDoctorId);
    }
  }, [selectedDoctorId, selectedDate]);

  const handleDateChange = (date: Date) => {
    setSelectedDate(date);
    // 立即拉取當天詳情，避免依賴 useEffect 的異步更新導致體感延遲或狀態不同步
    if (selectedDoctorId) {
      refreshDayDetails(date, selectedDoctorId);
    }
  };

  const isTimeSlotPast = (dateStr: string, time: string) => {
    if (!time || !time.includes(":")) return false;
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const slot = new Date(y || 0, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
    return slot.getTime() <= new Date().getTime();
  };

  const bookAppointment = async (slot: TimeSlot, schedule: Schedule) => {
    if (!session || !patientId || !selectedDoctorId) return;
    setSuccess(null);
    setError(null);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          patientId,
          doctorId: selectedDoctorId,
          timeSlotId: slot.id,
          roomId: schedule.room.id,
        }),
      });
      // 安全解析，避免空響應導致 JSON 解析錯誤
      let data: any = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.error || "预约失败");
      setSuccess("预约成功");
      // 刷新我的预约映射
      const appointmentsRes = await fetch("/api/appointments");
      let appointments: Appointment[] = [];
      try { appointments = await appointmentsRes.json(); } catch { appointments = []; }
      const map: Record<string, string> = {};
      appointments.forEach((apt) => {
        if (apt.timeSlotId) map[apt.timeSlotId] = apt.id;
      });
      setMyAppointmentsBySlot(map);
      // 刷新当天详情与日历状态
      refreshDayDetails(selectedDate, selectedDoctorId);
      refreshCalendarStatuses(selectedDate, selectedDoctorId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发生未知错误");
    }
  };

  // 打開預約確認模態框
  const openBookingConfirm = (slot: TimeSlot, schedule: Schedule) => {
    setConfirmBookingData({ slot, schedule });
    setIsConfirmOpen(true);
  };

  // 在模態中確認預約
  const confirmBooking = async () => {
    if (!confirmBookingData) return;
    setIsConfirmSubmitting(true);
    try {
      await bookAppointment(confirmBookingData.slot, confirmBookingData.schedule);
      setIsConfirmOpen(false);
      setConfirmBookingData(null);
    } finally {
      setIsConfirmSubmitting(false);
    }
  };

  const cancelAppointment = async (appointmentId: string) => {
    setSuccess(null);
    setError(null);
    try {
      // 操作前確認
      const ok = typeof window !== 'undefined'
        ? window.confirm("确认取消该预约？")
        : true;
      if (!ok) return;

      const res = await fetch(`/api/appointments?appointmentId=${appointmentId}`, { method: "DELETE" });
      // 安全解析，避免空響應導致 JSON 解析錯誤
      let data: any = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.error || "取消预约失败");
      setSuccess("已取消预约");
      // 刷新我的预约映射
      const appointmentsRes = await fetch("/api/appointments");
      let appointments: Appointment[] = [];
      try { appointments = await appointmentsRes.json(); } catch { appointments = []; }
      const map: Record<string, string> = {};
      appointments.forEach((apt) => {
        if (apt.timeSlotId) map[apt.timeSlotId] = apt.id;
      });
      setMyAppointmentsBySlot(map);
      // 刷新当天详情与日历状态
      refreshDayDetails(selectedDate, selectedDoctorId);
      refreshCalendarStatuses(selectedDate, selectedDoctorId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发生未知错误");
    }
  };

  if (status === "loading") return <main className="mobile-loading-container">正在加载...</main>;

  return (
    <main className="mobile-container">
      {/* 顶部为医生选择，样式统一适配手机 */}
      <div className="mobile-card">
        <div className="mobile-section-header"><h3>选择医生</h3></div>
        {doctors.length === 0 ? (
          <p className="mobile-no-selection">暂无医生数据</p>
        ) : (
          <select
            className="mobile-input"
            value={selectedDoctorId}
            onChange={(e) => {
              setSelectedDoctorId(e.target.value);
              setSelectedDate(new Date());
            }}
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* 日历控件：显示该医生每个日期的预约/排班信息，并高亮有排班日期 */}
      <div className="mobile-card">
        <EnhancedDatePicker
          selectedDate={selectedDate}
          onDateChange={handleDateChange}
          dateStatuses={dateStatuses}
          isLoading={isCalendarLoading}
          onMonthChange={(year, month) => {
            if (selectedDoctorId) {
              const firstDay = new Date(year, month, 1);
              // 只刷新高亮，不改變已選日期
              refreshCalendarStatuses(firstDay, selectedDoctorId);
            }
          }}
        />
        {!selectedDoctorId && (
          <p className="mobile-no-selection" style={{ marginTop: '8px' }}>
            请选择医生以加载排班高亮与容量统计
          </p>
        )}
      </div>

      <div className="mobile-card">
        <div className="mobile-section-header"><h3>可预约时段</h3></div>
        {!selectedDoctorId && (
          <p className="mobile-no-selection">请选择医生以查看当天可预约时段</p>
        )}
        {selectedDoctorId && (
          <>
            {isDayLoading && <p className="mobile-loading-text">正在加载当天排班...</p>}
            {error && <p className="mobile-error-text">{error}</p>}
            {success && <p className="mobile-success-message">{success}</p>}
            {schedulesForSelectedDay.length === 0 ? (
              <p className="mobile-no-slots">该日暂无排班</p>
            ) : (
              <div className="space-y-4">
                {schedulesForSelectedDay.map((schedule) => (
                  <div key={schedule.id} className="mobile-schedule-container">
                    <h3 className="mobile-room-title">{schedule.room.name}</h3>
                    <div className="mobile-time-grid">
                      {schedule.timeSlots.map((slot) => {
                        const isPast = isTimeSlotPast(schedule.date, slot.startTime);
                        const isFull = slot.availableBeds <= 0;
                        const myAptId = slot.id && myAppointmentsBySlot[slot.id];
                        return (
                          <div key={slot.id} className={`mobile-time-slot ${myAptId ? 'booked' : isFull ? 'full' : ''}`}>
                            <div className="mobile-time-slot-label">
                              {slot.startTime} - {slot.endTime}（余 {Math.max(0, slot.availableBeds)}）
                            </div>
                            <div className="mobile-time-slot-actions" style={{ display: 'flex', gap: '8px' }}>
                              {!myAptId ? (
                                <button
                                  className={`mobile-btn ${isPast || isFull ? 'mobile-btn-disabled' : 'mobile-btn-primary'}`}
                                  disabled={isPast || isFull}
                                  onClick={() => openBookingConfirm(slot, schedule)}
                                >
                                  预约
                                </button>
                              ) : (
                                <button
                                  className="mobile-btn mobile-btn-danger"
                                  onClick={() => cancelAppointment(myAptId)}
                                >
                                  取消预约
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {/* 預約確認模態框 */}
      {isConfirmOpen && confirmBookingData && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h3 id="confirm-title" className="mobile-modal-title">确认预约</h3>
            <div className="mobile-modal-info">医生：{doctors.find(d => d.id === selectedDoctorId)?.name || '未知医生'}</div>
            <div className="mobile-modal-info">日期：{confirmBookingData.schedule.date}</div>
            <div className="mobile-modal-info">房间：{confirmBookingData.schedule.room.name}</div>
            <div className="mobile-modal-info">时段：{confirmBookingData.slot.startTime} - {confirmBookingData.slot.endTime}</div>
            <div className="mobile-modal-info">床位：余 {Math.max(0, confirmBookingData.slot.availableBeds)} / 总 {confirmBookingData.slot.bedCount}</div>
            <div className="mobile-modal-actions">
              <button className="mobile-modal-btn mobile-modal-btn-cancel" onClick={() => { setIsConfirmOpen(false); setConfirmBookingData(null); }}>
                取消
              </button>
              <button className="mobile-modal-btn mobile-modal-btn-confirm" onClick={confirmBooking} disabled={isConfirmSubmitting}>
                {isConfirmSubmitting ? '提交中…' : '确认预约'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}