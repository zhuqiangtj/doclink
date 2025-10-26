'use client';

import { useState, useEffect, FormEvent } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FaTrash, FaPlusCircle } from 'react-icons/fa';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface TimeSlot { time: string; total: number; booked: number; }
interface Schedule {
  id: string;
  date: string;
  room: Room;
  timeSlots: TimeSlot[];
}

const DEFAULT_TIMES = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

// --- Component ---
export default function ScheduleCalendar({ initialScheduledDates, rooms, doctorProfile }: { initialScheduledDates: string[], rooms: Room[], doctorProfile: DoctorProfile }) {
  const [highlightedDates, setHighlightedDates] = useState<Date[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // State for the modal form
  const [schedulesForSelectedDate, setSchedulesForSelectedDate] = useState<Schedule[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [timeSlots, setTimeSlots] = useState<Partial<TimeSlot>[]>([]);

  useEffect(() => {
    setHighlightedDates(initialScheduledDates.map(d => new Date(d)));
  }, [initialScheduledDates]);

  const handleDateClick = async (date: Date) => {
    setSelectedDate(date);
    setIsModalOpen(true);
    setIsLoadingDetails(true);

    // In a real app, you'd fetch this. For now, we simulate.
    const existingSchedules = []; // Placeholder
    setSchedulesForSelectedDate(existingSchedules);
    setIsEditing(existingSchedules.length > 0);
    
    if (existingSchedules.length > 0) {
      setTimeSlots(existingSchedules[0].timeSlots);
    } else {
      setTimeSlots([]);
      setSelectedRoomId(rooms.length > 0 ? rooms[0].id : '');
    }

    setIsLoadingDetails(false);
  };

  const handleCreateInitialSchedule = () => {
    const room = rooms.find(r => r.id === selectedRoomId);
    if (!room) return;

    const defaultTimeSlots = DEFAULT_TIMES.map(time => ({ time, total: room.bedCount, booked: 0 }));
    setTimeSlots(defaultTimeSlots);
    setIsEditing(true); // Switch to editing mode
  };

  const handleTimeSlotChange = (index: number, field: keyof TimeSlot, value: string | number) => {
    const updatedSlots = [...timeSlots];
    updatedSlots[index] = { ...updatedSlots[index], [field]: value };
    setTimeSlots(updatedSlots);
  };

  const handleAddTimeSlot = () => {
    setTimeSlots([...timeSlots, { time: '17:00', total: 1, booked: 0 }]);
  };

  const handleDeleteTimeSlot = (index: number) => {
    setTimeSlots(timeSlots.filter((_, i) => i !== index));
  };

  const handleSaveSchedule = async () => {
    // This would call the POST or PUT API endpoint
    console.log('Saving schedule:', { date: selectedDate, roomId: selectedRoomId, timeSlots });
    // On success:
    // 1. Update highlightedDates
    // 2. Close modal
    setIsModalOpen(false);
  };

  return (
    <>
      <div className="bg-white p-8 rounded-2xl shadow-lg">
        <DatePicker
          selected={null}
          onChange={handleDateClick}
          inline
          highlightDates={highlightedDates}
          className="w-full"
        />
      </div>

      {isModalOpen && selectedDate && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-2xl">
            <h2 className="text-3xl font-bold mb-6">{timeSlots.length > 0 ? '编辑' : '创建'} {selectedDate.toLocaleDateString()} 的排班</h2>
            
            {isLoadingDetails ? <p>正在加载...</p> : (
              <div className="space-y-6">
                {!isEditing ? (
                  <div className="flex items-end gap-4">
                    <div className="flex-grow">
                      <label htmlFor="room" className="block text-lg font-medium">选择诊室</label>
                      <select id="room" value={selectedRoomId} onChange={e => setSelectedRoomId(e.target.value)} className="input-base mt-2" required>
                        {rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                      </select>
                    </div>
                    <button onClick={handleCreateInitialSchedule} className="btn btn-primary text-lg">创建</button>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-72 overflow-y-auto">
                    {timeSlots.map((slot, index) => (
                      <div key={index} className="flex items-center gap-4 p-2 border rounded-lg">
                        <input type="text" value={slot.time} onChange={e => handleTimeSlotChange(index, 'time', e.target.value)} className="input-base w-28" />
                        <input type="number" value={slot.total} onChange={e => handleTimeSlotChange(index, 'total', Number(e.target.value))} className="input-base w-24" />
                        <button onClick={() => handleDeleteTimeSlot(index)} className="text-red-500 hover:text-red-700"><FaTrash /></button>
                      </div>
                    ))}
                    <button onClick={handleAddTimeSlot} className="btn btn-secondary text-sm flex items-center gap-2"><FaPlusCircle /> 增加时间点</button>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-4 mt-8">
              <button type="button" onClick={() => setIsModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">取消</button>
              {isEditing && <button onClick={handleSaveSchedule} className="btn btn-primary text-lg">保存排班</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
