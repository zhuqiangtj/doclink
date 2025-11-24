"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import EnhancedDatePicker, { DateStatus } from "../components/EnhancedDatePicker";
import "../components/EnhancedDatePicker.css";
import "./mobile.css";
import { fetchPublicDateStatusesForMonth } from "../utils/publicDateStatusUtils";
import { isPastDate } from "../utils/dateStatusUtils";

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
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateStatuses, setDateStatuses] = useState<DateStatus[]>([]);
  const [isCalendarLoading, setIsCalendarLoading] = useState<boolean>(false);

  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);
  const [isDayLoading, setIsDayLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [patientId, setPatientId] = useState<string | null>(null);
  const [myAppointmentsBySlot, setMyAppointmentsBySlot] = useState<Record<string, string>>({}); // timeSlotId -> appointmentId
  const [selectedTimeSlotId, setSelectedTimeSlotId] = useState<string | null>(null);
  // 預約確認模態框狀態
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [confirmBookingData, setConfirmBookingData] = useState<{ slot: TimeSlot; schedule: Schedule } | null>(null);
  const [isConfirmSubmitting, setIsConfirmSubmitting] = useState<boolean>(false);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const selectedDateRef = useRef<Date>(selectedDate);
  const selectedDoctorIdRef = useRef<string>(selectedDoctorId);

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
          // 并行加载当月日历状态与当天详情，缩短首屏时间
          await Promise.all([
            refreshCalendarStatuses(selectedDate, firstId),
            refreshDayDetails(selectedDate, firstId),
          ]);
        }

        if (!userRes.ok) throw new Error("获取用户资料失败。");
        const userData = await userRes.json();
        if (!userData.patientProfile) throw new Error("未找到患者资料。");
        setPatientId(userData.patientProfile.id);

        if (!appointmentsRes.ok) throw new Error("获取我的预约失败。");
        const appointments: Appointment[] = await appointmentsRes.json();
        const map: Record<string, string> = {};
        appointments.forEach((apt) => {
          // 仅将“待进行”预约映射到时间段，避免取消/完成等状态误标记
          if (apt.timeSlotId && apt.status === "PENDING") {
            map[apt.timeSlotId] = apt.id;
          }
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
      const year = date.getFullYear();
      const month = date.getMonth();
      const statuses = await fetchPublicDateStatusesForMonth(year, month, doctorId);
      setDateStatuses(statuses);
      // 预取相邻月份，提升月份切换体验
      import('../utils/publicDateStatusUtils').then(({ prefetchPublicMonthStatuses }) => {
        prefetchPublicMonthStatuses(year, month === 0 ? 11 : month - 1, doctorId);
        prefetchPublicMonthStatuses(year, month === 11 ? 0 : month + 1, doctorId);
      });
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

      // 构建当日诊室列表（去重）并设置默认选中
      const uniqueRoomsMap = new Map<string, string>();
      details.forEach((d) => {
        if (d?.room?.id && d?.room?.name) {
          uniqueRoomsMap.set(d.room.id, d.room.name);
        }
      });
      const uniqueRooms = Array.from(uniqueRoomsMap.entries()).map(([id, name]) => ({ id, name }));
      setRooms(uniqueRooms);
      // 若当前选中的诊室不在当日列表中，则默认选中第一个
      if (uniqueRooms.length === 0) {
        setSelectedRoomId("");
      } else if (!selectedRoomId || !uniqueRooms.find(r => r.id === selectedRoomId)) {
        setSelectedRoomId(uniqueRooms[0].id);
      }

      // 同步“我的预约”映射：避免医生取消后本页仍显示“已预约”
      try {
        const appointmentsRes = await fetch("/api/appointments");
        if (appointmentsRes.ok) {
          const appointments: Appointment[] = await appointmentsRes.json();
          const map: Record<string, string> = {};
          appointments.forEach((apt) => {
            if (apt.timeSlotId && apt.status === "PENDING") {
              map[apt.timeSlotId] = apt.id;
            }
          });
          setMyAppointmentsBySlot(map);
        }
      } catch (err) {
        // 静默失败：不影响主要页面数据加载
        console.warn("刷新当天详情时同步我的预约映射失败", err);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "发生未知错误");
      setRooms([]);
      setSelectedRoomId("");
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

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);
  useEffect(() => {
    selectedDoctorIdRef.current = selectedDoctorId;
  }, [selectedDoctorId]);

  const mergeSchedulesGranular = useCallback((prev: Schedule[], next: Schedule[], dateVal: Date) => {
    const selectedDateStr = toYYYYMMDD(dateVal);
    const nextById = new Map<string, Schedule>();
    for (const s of next) nextById.set(s.id, s);
    let changed = false;
    const merged: Schedule[] = prev.map((s) => {
      const ns = nextById.get(s.id);
      if (!ns) return s;
      const nsSlotsById = new Map<string, TimeSlot>();
      for (const t of ns.timeSlots || []) nsSlotsById.set(t.id, t);
      const prevSlotsById = new Map<string, TimeSlot>();
      for (const t of s.timeSlots || []) prevSlotsById.set(t.id, t);
      const ids = new Set<string>([...prevSlotsById.keys(), ...nsSlotsById.keys()]);
      const updatedSlots: TimeSlot[] = [];
      ids.forEach((id) => {
        const oldSlot = prevSlotsById.get(id);
        const newSlot = nsSlotsById.get(id);
        if (!newSlot && oldSlot) {
          changed = true;
          return;
        }
        if (newSlot && !oldSlot) {
          changed = true;
          updatedSlots.push(newSlot);
          return;
        }
        if (newSlot && oldSlot) {
          const diff = (
            oldSlot.availableBeds !== newSlot.availableBeds ||
            oldSlot.bedCount !== newSlot.bedCount ||
            oldSlot.isActive !== newSlot.isActive ||
            oldSlot.startTime !== newSlot.startTime ||
            oldSlot.endTime !== newSlot.endTime ||
            (Array.isArray(oldSlot.appointments) ? oldSlot.appointments.length : 0) !== (Array.isArray(newSlot.appointments) ? newSlot.appointments.length : 0)
          );
          updatedSlots.push(diff ? newSlot : oldSlot);
          if (diff) changed = true;
        }
      });
      updatedSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
      return { ...s, timeSlots: updatedSlots };
    });
    for (const s of next) {
      if (!prev.some((ps) => ps.id === s.id)) {
        merged.push(s);
        changed = true;
      }
    }
    const totals = merged.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
      for (const ts of sch.timeSlots || []) {
        acc.totalBeds += Number(ts.bedCount || 0);
        const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
        acc.bookedBeds += used > 0 ? used : 0;
      }
      return acc;
    }, { bookedBeds: 0, totalBeds: 0 });
    const updatedStatus = {
      date: selectedDateStr,
      hasSchedule: merged.some((s) => (s.timeSlots || []).length > 0),
      hasAppointments: totals.bookedBeds > 0,
      bookedBeds: totals.bookedBeds,
      totalBeds: totals.totalBeds,
      isPast: isPastDate(dateVal),
    };
    setDateStatuses((prevStatuses) => {
      const idx = prevStatuses.findIndex((st) => st.date === selectedDateStr);
      if (idx >= 0) {
        const copy = [...prevStatuses];
        copy[idx] = updatedStatus;
        return copy;
      }
      return [...prevStatuses, updatedStatus];
    });
    return { merged, changed };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const doctorId = selectedDoctorIdRef.current;
        if (!doctorId) return;
        const dateStr = toYYYYMMDD(selectedDateRef.current);
        const res = await fetch(`/api/public/schedules?doctorId=${doctorId}&date=${dateStr}`, { cache: 'no-store' });
        if (!res.ok) return;
        const nextDetails: Schedule[] = await res.json();
        setSchedulesForSelectedDay((prev) => {
          const { merged, changed } = mergeSchedulesGranular(prev, nextDetails, selectedDateRef.current);
          if (changed) setOverlayText('已自动更新');
          return merged;
        });
        await refreshCalendarStatuses(selectedDateRef.current, doctorId);
        try {
          const appointmentsRes = await fetch('/api/appointments');
          if (appointmentsRes.ok) {
            const appointments: Appointment[] = await appointmentsRes.json();
            const map: Record<string, string> = {};
            appointments.forEach((apt) => { if (apt.timeSlotId && apt.status === 'PENDING') { map[apt.timeSlotId] = apt.id; } });
            setMyAppointmentsBySlot(map);
          }
        } catch {}
      } catch {}
    };
    timer = setInterval(run, 60000);
    return () => { if (timer) clearInterval(timer); };
  }, [status, mergeSchedulesGranular]);

  // SSE: 订阅与患者相关的事件（预约创建/取消/状态变更/医生排班变更）并执行精细更新
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!patientId) return;
    try {
      const es = new EventSource(`/api/realtime/subscribe?kind=patient&id=${patientId}`);
      es.onmessage = async (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          const type = evt?.type as string | undefined;
          const payload = evt?.payload as any;
          const timeSlotId = payload?.timeSlotId as string | undefined;
          const appointmentId = payload?.appointmentId as string | undefined;
          if (!type) return;
          let msg: string | null = null;
          if (type === 'APPOINTMENT_CREATED') msg = '新增预约已同步';
          else if (type === 'APPOINTMENT_CANCELLED') msg = '取消预约已同步';
          else if (type === 'APPOINTMENT_STATUS_UPDATED') msg = '预约状态已同步';
          else if (type === 'DOCTOR_SCHEDULE_UPDATED') msg = '医生排班已更新';
          if (msg) setOverlayText(msg);
          if (!selectedDoctorId) return;
          switch (type) {
            case 'APPOINTMENT_CREATED':
              if (timeSlotId && appointmentId) {
                setMyAppointmentsBySlot(prev => ({ ...prev, [timeSlotId]: appointmentId }));
                const selectedDateStr = toYYYYMMDD(selectedDate);
                setSchedulesForSelectedDay(prev => {
                  const next = prev.map(s => {
                    if (s.date !== selectedDateStr) return s;
                    const has = s.timeSlots.some(t => t.id === timeSlotId);
                    if (!has) return s;
                    return {
                      ...s,
                      timeSlots: s.timeSlots.map(t => {
                        if (t.id !== timeSlotId) return t;
                        const nb = Math.max(0, Number(t.availableBeds || 0) - 1);
                        return { ...t, availableBeds: nb };
                      })
                    };
                  });
                  const totals = next.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
                    for (const ts of sch.timeSlots || []) {
                      acc.totalBeds += Number(ts.bedCount || 0);
                      const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
                      acc.bookedBeds += used > 0 ? used : 0;
                    }
                    return acc;
                  }, { bookedBeds: 0, totalBeds: 0 });
                  const updatedStatus = {
                    date: selectedDateStr,
                    hasSchedule: next.some(s => (s.timeSlots || []).length > 0),
                    hasAppointments: totals.bookedBeds > 0,
                    bookedBeds: totals.bookedBeds,
                    totalBeds: totals.totalBeds,
                    isPast: isPastDate(selectedDate),
                  };
                  setDateStatuses(prevStatuses => {
                    const idx = prevStatuses.findIndex(st => st.date === selectedDateStr);
                    if (idx >= 0) {
                      const copy = [...prevStatuses];
                      copy[idx] = updatedStatus;
                      return copy;
                    }
                    return [...prevStatuses, updatedStatus];
                  });
                  return next;
                });
                await refreshPublicTimeSlotById(timeSlotId);
              } else {
                await refreshDayDetails(selectedDate, selectedDoctorId);
                await refreshCalendarStatuses(selectedDate, selectedDoctorId);
              }
              break;
            case 'APPOINTMENT_CANCELLED':
              if (timeSlotId) {
                setMyAppointmentsBySlot(prev => {
                  const copy = { ...prev };
                  delete copy[timeSlotId];
                  return copy;
                });
                const selectedDateStr = toYYYYMMDD(selectedDate);
                setSchedulesForSelectedDay(prev => {
                  const next = prev.map(s => {
                    if (s.date !== selectedDateStr) return s;
                    const updatedSlots = s.timeSlots.map(t => {
                      if (t.id !== timeSlotId) return t;
                      const nb = Math.min(Number(t.bedCount || 0), Number(t.availableBeds || 0) + 1);
                      return { ...t, availableBeds: nb };
                    });
                    return { ...s, timeSlots: updatedSlots };
                  });
                  const totals = next.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
                    for (const ts of sch.timeSlots || []) {
                      acc.totalBeds += Number(ts.bedCount || 0);
                      const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
                      acc.bookedBeds += used > 0 ? used : 0;
                    }
                    return acc;
                  }, { bookedBeds: 0, totalBeds: 0 });
                  const updatedStatus = {
                    date: selectedDateStr,
                    hasSchedule: next.some(s => (s.timeSlots || []).length > 0),
                    hasAppointments: totals.bookedBeds > 0,
                    bookedBeds: totals.bookedBeds,
                    totalBeds: totals.totalBeds,
                    isPast: isPastDate(selectedDate),
                  };
                  setDateStatuses(prevStatuses => {
                    const idx = prevStatuses.findIndex(st => st.date === selectedDateStr);
                    if (idx >= 0) {
                      const copy = [...prevStatuses];
                      copy[idx] = updatedStatus;
                      return copy;
                    }
                    return [...prevStatuses, updatedStatus];
                  });
                  return next;
                });
                await refreshPublicTimeSlotById(timeSlotId);
              } else {
                await refreshDayDetails(selectedDate, selectedDoctorId);
                await refreshCalendarStatuses(selectedDate, selectedDoctorId);
              }
              break;
            case 'APPOINTMENT_STATUS_UPDATED':
              {
                const newStatus = (payload?.newStatus as string | undefined) || '';
                if (timeSlotId && newStatus && newStatus !== 'PENDING') {
                  setMyAppointmentsBySlot(prev => {
                    const copy = { ...prev };
                    delete copy[timeSlotId];
                    return copy;
                  });
                }
                if (timeSlotId) {
                  await refreshPublicTimeSlotById(timeSlotId);
                } else {
                  await refreshDayDetails(selectedDate, selectedDoctorId);
                  await refreshCalendarStatuses(selectedDate, selectedDoctorId);
                }
              }
              break;
            default:
              break;
          }
        } catch {}
      };
      es.onerror = () => {};
      return () => es.close();
    } catch (err) {
      console.error('SSE subscribe (patient) failed:', err);
    }
  }, [status, patientId, selectedDoctorId, selectedDate]);

  // SSE: 订阅选中医生的排班事件（新建/更新/删除时段）并执行精细更新
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!selectedDoctorId) return;
    try {
      const es = new EventSource(`/api/realtime/subscribe?kind=doctor&id=${selectedDoctorId}`);
      es.onmessage = async (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          const type = evt?.type as string | undefined;
          const payload = evt?.payload as any;
          const timeSlotId = payload?.timeSlotId as string | undefined;
          let msg: string | null = null;
          if (type === 'TIMESLOT_CREATED') msg = '新增时段已同步';
          else if (type === 'TIMESLOT_UPDATED') msg = '时段修改已同步';
          else if (type === 'TIMESLOT_DELETED') msg = '时段删除已同步';
          if (msg) setOverlayText(msg);
          switch (type) {
            case 'TIMESLOT_CREATED':
            case 'TIMESLOT_UPDATED':
            case 'TIMESLOT_DELETED':
              if (timeSlotId) {
                if (type === 'TIMESLOT_DELETED') {
                  setSchedulesForSelectedDay(prev => {
                    const next = prev.map(s => ({
                      ...s,
                      timeSlots: (s.timeSlots || []).filter(t => t.id !== timeSlotId)
                    }));
                    const dateStr = toYYYYMMDD(selectedDate);
                    const totals = next.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
                      for (const ts of sch.timeSlots || []) {
                        acc.totalBeds += Number(ts.bedCount || 0);
                        const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
                        acc.bookedBeds += used > 0 ? used : 0;
                      }
                      return acc;
                    }, { bookedBeds: 0, totalBeds: 0 });
                    const updatedStatus = {
                      date: dateStr,
                      hasSchedule: next.some(s => (s.timeSlots || []).length > 0),
                      hasAppointments: totals.bookedBeds > 0,
                      bookedBeds: totals.bookedBeds,
                      totalBeds: totals.totalBeds,
                      isPast: isPastDate(selectedDate),
                    };
                    setDateStatuses(prevStatuses => {
                      const idx = prevStatuses.findIndex(st => st.date === dateStr);
                      if (idx >= 0) {
                        const copy = [...prevStatuses];
                        copy[idx] = updatedStatus;
                        return copy;
                      }
                      return [...prevStatuses, updatedStatus];
                    });
                    return next;
                  });
                } else {
                  await refreshPublicTimeSlotById(timeSlotId);
                }
              } else {
                await refreshDayDetails(selectedDate, selectedDoctorId);
              }
              break;
            case 'APPOINTMENT_CREATED':
            case 'APPOINTMENT_CANCELLED':
            case 'APPOINTMENT_STATUS_UPDATED':
            case 'DOCTOR_SCHEDULE_UPDATED':
              if (timeSlotId) {
                await refreshPublicTimeSlotById(timeSlotId);
              } else {
                await refreshDayDetails(selectedDate, selectedDoctorId);
              }
              break;
            default:
              break;
          }
        } catch {}
      };
      es.onerror = () => {
        // 自动重连
      };
      return () => es.close();
    } catch (err) {
      console.error('SSE subscribe (doctor) failed:', err);
    }
  }, [status, selectedDoctorId, selectedDate]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!doctors || doctors.length === 0) return;
    const others = doctors.map(d => d.id).filter(id => id !== selectedDoctorId);
    const sources: EventSource[] = [];
    others.forEach(id => {
      try {
        const es = new EventSource(`/api/realtime/subscribe?kind=doctor&id=${id}`);
        es.onmessage = (ev) => {
          try {
            const evt = JSON.parse(ev.data);
            const type = evt?.type as string | undefined;
            let msg: string | null = null;
            if (type === 'TIMESLOT_CREATED') msg = '新增时段已同步';
            else if (type === 'TIMESLOT_UPDATED') msg = '时段修改已同步';
            else if (type === 'TIMESLOT_DELETED') msg = '时段删除已同步';
            if (msg) setOverlayText(msg);
            const payload = evt?.payload as any;
            const timeSlotId = payload?.timeSlotId as string | undefined;
            if (id === selectedDoctorId) {
              if (type === 'TIMESLOT_CREATED' || type === 'TIMESLOT_UPDATED' || type === 'TIMESLOT_DELETED') {
                if (timeSlotId) {
                  refreshPublicTimeSlotById(timeSlotId);
                } else {
                  refreshDayDetails(selectedDate, selectedDoctorId);
                }
              }
            }
          } catch {}
        };
        es.onerror = () => {};
        sources.push(es);
      } catch {}
    });
    return () => { sources.forEach(es => es.close()); };
  }, [status, doctors, selectedDoctorId]);

  useEffect(() => {
    if (!overlayText) return;
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  const refreshSingleDateStatus = async (dateStr: string, doctorId: string) => {
    try {
      const res = await fetch(`/api/public/schedules?doctorId=${doctorId}&date=${dateStr}`, { cache: 'no-store' });
      if (!res.ok) return;
      const details: Schedule[] = await res.json();
      const totals = details.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
        for (const ts of sch.timeSlots || []) {
          acc.totalBeds += Number(ts.bedCount || 0);
          const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
          acc.bookedBeds += used > 0 ? used : 0;
        }
        return acc;
      }, { bookedBeds: 0, totalBeds: 0 });
      const parts = dateStr.split('-').map(Number);
      const dv = new Date(parts[0] || 0, (parts[1] || 1) - 1, parts[2] || 1);
      const updatedStatus = {
        date: dateStr,
        hasSchedule: details.some(s => (s.timeSlots || []).length > 0),
        hasAppointments: totals.bookedBeds > 0,
        bookedBeds: totals.bookedBeds,
        totalBeds: totals.totalBeds,
        isPast: isPastDate(dv),
      };
      setDateStatuses(prevStatuses => {
        const idx = prevStatuses.findIndex(st => st.date === dateStr);
        if (idx >= 0) {
          const copy = [...prevStatuses];
          copy[idx] = updatedStatus;
          return copy;
        }
        return [...prevStatuses, updatedStatus];
      });
    } catch {}
  };

  const refreshPublicTimeSlotById = async (id: string) => {
    if (!selectedDoctorId) return;
    try {
      const res = await fetch(`/api/public/schedules?doctorId=${selectedDoctorId}&timeSlotId=${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const arr = await res.json();
      const updatedSchedule: Schedule | null = Array.isArray(arr) ? arr[0] : null;
      if (!updatedSchedule || !updatedSchedule.timeSlots || updatedSchedule.timeSlots.length === 0) return;
      const updatedSlot = updatedSchedule.timeSlots[0];
      const selectedDateStr = toYYYYMMDD(selectedDate);

      await refreshSingleDateStatus(updatedSchedule.date, selectedDoctorId);

      setSchedulesForSelectedDay(prev => {
        if (updatedSchedule.date !== selectedDateStr) {
          return prev;
        }
        let scheduleExists = prev.some(s => s.id === updatedSchedule.id);
        const next = prev.map(s => {
          if (s.id === updatedSchedule.id) {
            const has = s.timeSlots.some(t => t.id === updatedSlot.id);
            const mergedSlots = has
              ? s.timeSlots.map(t => (t.id === updatedSlot.id ? updatedSlot : t))
              : [...s.timeSlots, updatedSlot].sort((a, b) => a.startTime.localeCompare(b.startTime));
            return { ...s, timeSlots: mergedSlots };
          }
          return s;
        });
        const finalNext = scheduleExists ? next : [...next, updatedSchedule];
        const dateStr = selectedDateStr;
        const totals = finalNext.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
          for (const ts of sch.timeSlots || []) {
            acc.totalBeds += Number(ts.bedCount || 0);
            const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
            acc.bookedBeds += used > 0 ? used : 0;
          }
          return acc;
        }, { bookedBeds: 0, totalBeds: 0 });
        const updatedStatus = {
          date: dateStr,
          hasSchedule: finalNext.some(s => (s.timeSlots || []).length > 0),
          hasAppointments: totals.bookedBeds > 0,
          bookedBeds: totals.bookedBeds,
          totalBeds: totals.totalBeds,
          isPast: isPastDate(selectedDate),
        };
        setDateStatuses(prevStatuses => {
          const idx = prevStatuses.findIndex(st => st.date === dateStr);
          if (idx >= 0) {
            const copy = [...prevStatuses];
            copy[idx] = updatedStatus;
            return copy;
          }
          return [...prevStatuses, updatedStatus];
        });
        return finalNext;
      });
    } catch {}
  };

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
  const isWithinThreeDaysFromToday = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const slotDate = new Date(y || 0, (m || 1) - 1, d || 1);
    slotDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((slotDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    return diffDays >= 0 && diffDays <= 3;
  };

  const isWithinSeventyTwoHoursFromNow = (dateStr: string, time: string) => {
    if (!time || !time.includes(":")) return false;
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const slot = new Date(y || 0, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
    const now = new Date();
    const diff = slot.getTime() - now.getTime();
    return diff >= 0 && diff <= 72 * 60 * 60 * 1000;
  };

  const bookAppointment = async (slot: TimeSlot, schedule: Schedule) => {
    if (!session || !patientId || !selectedDoctorId) return;
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
      // 刷新我的预约映射
      const appointmentsRes = await fetch("/api/appointments");
      let appointments: Appointment[] = [];
      try { appointments = await appointmentsRes.json(); } catch { appointments = []; }
      const map: Record<string, string> = {};
      appointments.forEach((apt) => {
        if (apt.timeSlotId && apt.status === "PENDING") {
          map[apt.timeSlotId] = apt.id;
        }
      });
      setMyAppointmentsBySlot(map);
      // 刷新当天详情与日历状态
      refreshDayDetails(selectedDate, selectedDoctorId);
      refreshCalendarStatuses(selectedDate, selectedDoctorId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      let friendly = msg || "发生未知错误";
      if (msg.includes("fully booked") || msg.includes("已被抢完") || msg.includes("This time slot is fully booked")) {
        friendly = "该时段已被抢完，请选择其它时段";
      } else if (msg.includes("已经过期") || msg.includes("expired")) {
        friendly = "预约时间已过期";
      } else if (msg.includes("积分不足") || msg.includes("credibility")) {
        friendly = "积分不足，无法预约";
      } else if (msg.includes("不能重复预约") || msg.includes("duplicate")) {
        friendly = "已在该时段有预约";
      } else if (msg.includes("该病人在此时段已有预约")) {
        friendly = "该病人在此时段已有预约";
      } else if (msg.includes("not found")) {
        friendly = "时段不存在或已被删除";
      }
      setError(friendly);
      if (slot?.id) {
        try { await refreshPublicTimeSlotById(slot.id); } catch {}
      }
      setOverlayText(friendly);
    }
  };

  const [, triggerTimeRefresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => triggerTimeRefresh(v => v + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // 打開預約確認模態框
  const openBookingConfirm = (slot: TimeSlot, schedule: Schedule) => {
    const allowed = isWithinSeventyTwoHoursFromNow(schedule.date, slot.startTime) && !isTimeSlotPast(schedule.date, slot.startTime);
    if (!allowed) { setOverlayText('仅可预约未来三天内的时段'); return; }
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
    setError(null);
    try {
      // 操作前確認
      const ok = typeof window !== 'undefined'
        ? window.confirm("确认取消该预约？")
        : true;
      if (!ok) return;

      const res = await fetch(`/api/appointments/${appointmentId}`, { method: "DELETE" });
      // 安全解析，避免空響應導致 JSON 解析錯誤
      let data: any = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.error || "取消预约失败");
      // 刷新我的预约映射
      const appointmentsRes = await fetch("/api/appointments");
      let appointments: Appointment[] = [];
      try { appointments = await appointmentsRes.json(); } catch { appointments = []; }
      const map: Record<string, string> = {};
      appointments.forEach((apt) => {
        if (apt.timeSlotId && apt.status === "PENDING") {
          map[apt.timeSlotId] = apt.id;
        }
      });
      setMyAppointmentsBySlot(map);
      // 刷新当天详情与日历状态
      refreshDayDetails(selectedDate, selectedDoctorId);
      refreshCalendarStatuses(selectedDate, selectedDoctorId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      let friendly = msg || "发生未知错误";
      if (msg.includes("已到预约时间") || msg.includes("无法取消")) {
        friendly = "已到预约时间，无法取消";
      }
      setError(friendly);
      try {
        const appointmentsRes = await fetch("/api/appointments");
        if (appointmentsRes.ok) {
          const data = await appointmentsRes.json();
          const map: Record<string, string> = {};
          (data as Appointment[]).forEach((apt) => {
            if (apt.timeSlotId && apt.status === "PENDING") {
              map[apt.timeSlotId] = apt.id;
            }
          });
          setMyAppointmentsBySlot(map);
        }
      } catch {}
      refreshDayDetails(selectedDate, selectedDoctorId);
      refreshCalendarStatuses(selectedDate, selectedDoctorId);
      setOverlayText(friendly);
    }
  };

  if (status === "loading") return <main className="mobile-loading-container">正在加载...</main>;

  return (
    <main className="mobile-container">
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[2000]">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      {/* 顶部并列选择：医生与诊室（去掉标题） */}
      <div className="mobile-card">
        {doctors.length === 0 ? (
          <p className="mobile-no-selection">暂无医生数据</p>
        ) : (
          <div className="mobile-top-controls">
            <div className="mobile-control">
              <label className="mobile-control-label">医生</label>
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
            </div>
            <div className="mobile-control">
              <label className="mobile-control-label">诊室</label>
              <select
                className="mobile-input"
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
              >
                {rooms.length === 0 ? (
                  <option value="">当日无诊室</option>
                ) : (
                  rooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))
                )}
              </select>
            </div>
          </div>
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
            {!isWithinThreeDaysFromToday(toYYYYMMDD(selectedDate)) && (
              <p className="text-xs text-gray-600" style={{ marginBottom: '6px' }}>仅可预约未来三天内的时段</p>
            )}
            {schedulesForSelectedDay.length === 0 ? (
              <p className="mobile-no-slots">该日暂无排班</p>
            ) : (
              <div className="space-y-4">
                {schedulesForSelectedDay
                  .filter((s) => !selectedRoomId || s.room.id === selectedRoomId)
                  .map((schedule) => (
                  <div key={schedule.id} className="mobile-schedule-container">
                    <h3 className="mobile-room-title">{schedule.room.name}</h3>
                    <div className="mobile-time-grid">
                      {schedule.timeSlots.map((slot) => {
                        const isPast = isTimeSlotPast(schedule.date, slot.startTime);
                        const within3Days = isWithinSeventyTwoHoursFromNow(schedule.date, slot.startTime);
                        const isFull = slot.availableBeds <= 0;
                        const myAptId = slot.id && myAppointmentsBySlot[slot.id];
                        return (
                          <div
                            key={slot.id}
                            className={`mobile-time-slot ${myAptId ? 'booked' : isFull ? 'full' : ''} ${isPast ? 'past' : ''} ${selectedTimeSlotId === slot.id ? 'selected' : ''}`}
                            onClick={(e) => {
                              const target = e.target as HTMLElement;
                              if (
                                target.closest('button') ||
                                target.closest('.mobile-btn')
                              ) return;
                              setSelectedTimeSlotId(prev => (prev === slot.id ? null : slot.id));
                            }}
                          >
                            <div className="mobile-time-slot-time">
                              {slot.startTime} - {slot.endTime}
                            </div>
                            <div className="mobile-time-slot-info">
                              空余床位：{Math.max(0, slot.availableBeds)}
                            </div>
                            <div className="mobile-time-slot-actions" style={{ display: 'flex', gap: '8px' }}>
                              {!myAptId ? (
                                <button
                                  className={`mobile-btn ${isPast || isFull || !within3Days ? 'mobile-btn-disabled' : 'mobile-btn-primary'}`}
                                  disabled={isPast || isFull || !within3Days}
                                  onClick={() => openBookingConfirm(slot, schedule)}
                                >
                                  预约
                                </button>
                              ) : (
                                <button
                                  className={`mobile-btn ${isPast ? 'mobile-btn-disabled' : 'mobile-btn-danger'}`}
                                  disabled={isPast}
                                  title={isPast ? '已到预约时间，无法取消' : '取消预约'}
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
              <button className="mobile-modal-btn mobile-modal-btn-cancel" onClick={() => { if (isConfirmSubmitting) return; setIsConfirmOpen(false); setConfirmBookingData(null); }} disabled={isConfirmSubmitting}>
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