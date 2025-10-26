'use client';

import { useState, useEffect } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface TimeSlot { time: string; total: number; booked: number; }
interface Schedule { id: string; date: string; room: Room; timeSlots: TimeSlot[]; }

export default function ScheduleCalendar({ initialScheduledDates }: { initialScheduledDates: string[] }) {
  const [highlightedDates, setHighlightedDates] = useState<Date[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  useEffect(() => {
    setHighlightedDates(initialScheduledDates.map(d => new Date(d)));
  }, [initialScheduledDates]);

  const handleDateClick = async (date: Date) => {
    setSelectedDate(date);
    setIsModalOpen(true);
    setIsLoadingDetails(true);
    // In a real scenario, you would fetch details for the selected date here.
    // For now, we just simulate a loading state.
    setTimeout(() => {
      setIsLoadingDetails(false);
    }, 500); // Simulate network delay
  };

  return (
    <>
      <div className="bg-white p-8 rounded-2xl shadow-lg">
        <DatePicker
          selected={selectedDate}
          onChange={handleDateClick}
          inline
          highlightDates={highlightedDates}
          className="w-full"
        />
      </div>

      {isModalOpen && selectedDate && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-2xl">
            <h2 className="text-3xl font-bold mb-6">{selectedDate.toLocaleDateString()} 的排班</h2>
            
            {isLoadingDetails ? (
              <p>正在加载详情...</p>
            ) : (
              <p>这里将显示当天的排班详情或创建新排班的表单。</p>
            )}

            <div className="flex justify-end gap-4 mt-8">
              <button type="button" onClick={() => setIsModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">关闭</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}