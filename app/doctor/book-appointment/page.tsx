'use client';

import { useState, useEffect, FormEvent, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import './mobile.css';

// --- Interfaces ---
interface Patient {
  id: string;
  userId: string;
  username: string;
  name: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
}

interface ScheduleTimeSlot {
  time: string;
  total: number;
  booked: number;
}

interface ScheduleApiResponse {
  id: string;
  date: string;
  roomId: string;
  room: { name: string };
  timeSlots: ScheduleTimeSlot[];
}

interface Schedule {
  id: string;
  date: string;
  roomId: string;
  roomName: string;
  timeSlots: ScheduleTimeSlot[];
}

interface DoctorProfile {
  id: string;
  name: string;
}

// --- Component ---
export default function BookAppointmentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [searchedPatients, setSearchedPatients] = useState<Patient[]>([]);

  // --- Form States ---
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [selectedTime, setSelectedTime] = useState('');

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const schedulesSnapshotRef = useRef<Map<string, string>>(new Map());

  // --- Effects ---
  // Auth check and initial data load
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status !== 'authenticated' || !session?.user?.id) return;

    if (session.user.role !== 'DOCTOR') {
      setError('Access Denied.');
      return;
    }

    const fetchData = async () => {
        setIsLoading(true);
        try {
          const userRes = await fetch(`/api/user/${session.user.id}`);
          const userData = await userRes.json();
          if (!userData.doctorProfile) throw new Error('Doctor profile not found.');
          setDoctorProfile(userData.doctorProfile);

          const schedulesRes = await fetch(`/api/schedules`); // Fetches own schedules
          const schedulesData: ScheduleApiResponse[] = await schedulesRes.json();
          const formattedSchedules = schedulesData.map(s => ({ ...s, roomName: s.room.name }));
          setSchedules(formattedSchedules);

        } catch (err) {
          setError(err instanceof Error ? err.message : 'An unknown error occurred');
        } finally {
          setIsLoading(false);
        }
      };
      fetchData();
  }, [status, session, router]);

  const mergeSchedulesGranular = useCallback((prev: Schedule[], next: Schedule[]) => {
    const nextById = new Map<string, Schedule>();
    for (const s of next) nextById.set(s.id, s);
    let changed = false;
    const merged: Schedule[] = prev.map((s) => {
      const ns = nextById.get(s.id);
      if (!ns) return s;
      const nsSlotsByTime = new Map<string, ScheduleTimeSlot>();
      for (const t of ns.timeSlots || []) nsSlotsByTime.set(t.time, t);
      const prevSlotsByTime = new Map<string, ScheduleTimeSlot>();
      for (const t of s.timeSlots || []) prevSlotsByTime.set(t.time, t);
      const keys = new Set<string>([...prevSlotsByTime.keys(), ...nsSlotsByTime.keys()]);
      const updated: ScheduleTimeSlot[] = [];
      keys.forEach((k) => {
        const oldSlot = prevSlotsByTime.get(k);
        const newSlot = nsSlotsByTime.get(k);
        if (!newSlot && oldSlot) { changed = true; return; }
        if (newSlot && !oldSlot) { changed = true; updated.push(newSlot); return; }
        if (newSlot && oldSlot) {
          const diff = oldSlot.total !== newSlot.total || oldSlot.booked !== newSlot.booked || oldSlot.time !== newSlot.time;
          updated.push(diff ? newSlot : oldSlot);
          if (diff) changed = true;
        }
      });
      updated.sort((a, b) => a.time.localeCompare(b.time));
      return { ...s, timeSlots: updated };
    });
    for (const s of next) { if (!prev.some(ps => ps.id === s.id)) { merged.push(s); changed = true; } }
    return { merged, changed };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!doctorProfile?.id) return;
    try {
      const es = new EventSource(`/api/realtime/subscribe?kind=doctor&id=${doctorProfile.id}`);
      es.onmessage = async (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          const type = evt?.type as string | undefined;
          switch (type) {
            case 'TIMESLOT_CREATED':
            case 'TIMESLOT_UPDATED':
            case 'TIMESLOT_DELETED':
            case 'APPOINTMENT_CREATED':
            case 'APPOINTMENT_CANCELLED':
            case 'APPOINTMENT_STATUS_UPDATED':
              {
                const res = await fetch(`/api/schedules`, { cache: 'no-store' });
                if (res.ok) {
                  const nextData: ScheduleApiResponse[] = await res.json();
                  const formatted = nextData.map(s => ({ ...s, roomName: s.room.name }));
                  setSchedules(prev => {
                    const { merged, changed } = mergeSchedulesGranular(prev, formatted);
                    if (changed) setOverlayText('已自动更新');
                    return merged;
                  });
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
    } catch {}
  }, [status, doctorProfile?.id, mergeSchedulesGranular]);

  useEffect(() => {
    const t = setTimeout(() => setOverlayText(null), 3000);
    return () => clearTimeout(t);
  }, [overlayText]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const res = await fetch(`/api/schedules`, { cache: 'no-store' });
        if (!res.ok) return;
        const nextData: ScheduleApiResponse[] = await res.json();
        const formatted = nextData.map(s => ({ ...s, roomName: s.room.name }));
        setSchedules(prev => {
          const { merged, changed } = mergeSchedulesGranular(prev, formatted);
          if (changed) setOverlayText('已自动更新');
          return merged;
        });
      } catch {}
    };
    timer = setInterval(run, 60000);
    return () => { if (timer) clearInterval(timer); };
  }, [status, mergeSchedulesGranular]);

  // --- Handlers ---
  const handlePatientSearch = async () => {
    if (!patientSearch) return;
    try {
      const res = await fetch(`/api/patients?search=${patientSearch}`);
      const data: Patient[] = await res.json();
      setSearchedPatients(data);
    } catch (_err) {
      setError('搜索病人失败。');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedPatient || !selectedScheduleId || !selectedTime || !doctorProfile) {
      setError('请选择病人、日期和时间段。');
      return;
    }
    
    const schedule = schedules.find(s => s.id === selectedScheduleId);
    if (!schedule) return;

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedPatient.userId, // Correct: Use the patient's User ID
          patientId: selectedPatient.id,    // Correct: Use the Patient Profile ID
          doctorId: doctorProfile.id,
          scheduleId: selectedScheduleId,
          time: selectedTime,
          roomId: schedule.roomId,
        }),
      });

      if (!response.ok) {
        let errorMessage = '预约失败。';
        try {
          const bodyText = await response.text();
          if (bodyText) {
            try {
              const errData = JSON.parse(bodyText);
              errorMessage = (errData && errData.error) ? errData.error : bodyText;
            } catch {
              errorMessage = bodyText;
            }
          }
        } catch {}
        throw new Error(errorMessage);
      }
      
      setSuccess(`成功为${selectedPatient.name}于${selectedTime}预约。`);
      // Reset form
      setPatientSearch('');
      setSearchedPatients([]);
      setSelectedPatient(null);
      setSelectedScheduleId('');
      setSelectedTime('');

    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      let friendly = msg || '发生未知错误';
      if (msg.includes('fully booked') || msg.includes('This time slot is fully booked')) {
        friendly = '该时段已被抢完，请选择其它时段';
      } else if (msg.includes('已经过期') || msg.includes('expired')) {
        friendly = '预约时间已过期';
      } else if (msg.includes('积分不足') || msg.includes('credibility')) {
        friendly = '病人积分不足，无法预约';
      } else if (msg.includes('不能重复预约') || msg.includes('duplicate')) {
        friendly = '该病人在此时段已有预约';
      }
      setError(friendly);
      try {
        const schedulesRes = await fetch(`/api/schedules`, { cache: 'no-store' });
        const schedulesData: ScheduleApiResponse[] = await schedulesRes.json();
        const formattedSchedules = schedulesData.map(s => ({ ...s, roomName: s.room.name }));
        setSchedules(formattedSchedules);
      } catch {}
      setOverlayText(friendly);
    }
  };

  // --- Render Logic ---
  if (isLoading || status === 'loading') return <div className="mobile-loading">加载中...</div>;
  if (error) return <div className="mobile-loading" style={{color: '#dc2626'}}>{error}</div>;

  return (
    <div className="mobile-container">
      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      <h1 className="mobile-header">为病人预约</h1>
      <form onSubmit={handleSubmit} className="mobile-form">
        
        {/* Patient Selection */}
        <div className="mobile-section">
          <h2 className="mobile-section-title">1. 查找病人</h2>
          <div className="mobile-search-group">
            <input
              type="text"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="按用户名或姓名搜索..."
              className="mobile-input mobile-input-flex"
            />
            <button type="button" onClick={handlePatientSearch} className="mobile-btn mobile-btn-primary">搜索</button>
          </div>
          {searchedPatients.length > 0 && (
            <ul className="mobile-search-results">
              {searchedPatients.map(p => (
                <li
                  key={p.id}
                  onClick={() => { setSelectedPatient(p); setSearchedPatients([]); setPatientSearch(p.name); }}
                  className="mobile-search-item"
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="truncate">
                      {p.name} ({p.username})
                    </div>
                    <div className="flex items-center ml-2 shrink-0 gap-2">
                      {p.phone && (
                        <a className="mobile-phone-badge" href={`tel:${String(p.phone).replace(/\s+/g,'')}`} aria-label={`拨打 ${p.phone}`}>{p.phone}</a>
                      )}
                      {p.dateOfBirth && (
                        <span className="mobile-patient-age">{p.dateOfBirth}</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        )}
        {selectedPatient && (
          <div className="mobile-selected-patient">
            已选择：{selectedPatient.name} ({selectedPatient.username})
            {selectedPatient.phone && (
              <a className="mobile-phone-badge" href={`tel:${String(selectedPatient.phone).replace(/\s+/g,'')}`} aria-label={`拨打 ${selectedPatient.phone}`} style={{ marginLeft: 8 }}>{selectedPatient.phone}</a>
            )}
          </div>
        )}
        </div>

        {/* Schedule Selection */}
        <div className="mobile-section">
          <h2 className="mobile-section-title">2. 选择预约时段</h2>
          <div className="mobile-input-group">
            <div>
              <label htmlFor="schedule" className="mobile-label">日期与诊室</label>
              <select id="schedule" value={selectedScheduleId} onChange={e => { setSelectedScheduleId(e.target.value); setSelectedTime(''); }} className="mobile-select" required>
                <option value="">-- 选择排班 --</option>
                {schedules.map(s => <option key={s.id} value={s.id}>{s.date} ({s.roomName})</option>)}
              </select>
            </div>
            {selectedScheduleId && (
              <div>
                <label className="mobile-label">时间段</label>
                <div className="mobile-time-slots">
                  {schedules.find(s => s.id === selectedScheduleId)?.timeSlots && Array.isArray(schedules.find(s => s.id === selectedScheduleId)?.timeSlots) ? 
                    schedules.find(s => s.id === selectedScheduleId)?.timeSlots.map(slot => (
                    <button
                      type="button"
                      key={slot.time}
                      onClick={() => setSelectedTime(slot.time)}
                      disabled={slot.booked >= slot.total}
                      className={`mobile-time-slot ${
                        selectedTime === slot.time ? 'mobile-time-slot-selected' : ''
                      } ${
                        slot.booked >= slot.total ? 'mobile-time-slot-disabled' : ''
                      }`}
                    >
                      <div>{slot.time}</div>
                      <div>({slot.booked}/{slot.total})</div>
                    </button>
                  )) : 
                    <p className="mobile-no-slots">暂无可用时间段</p>
                  }
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submission */}
        <button type="submit" className="mobile-btn mobile-btn-secondary mobile-btn-full" disabled={!selectedPatient || !selectedTime}>
          确认预约
        </button>

        {success && <div className="mobile-alert mobile-alert-success">{success}</div>}
        {error && <div className="mobile-alert mobile-alert-error">{error}</div>}
      </form>
    </div>
  );
}
