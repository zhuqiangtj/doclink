'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FaChevronLeft, FaChevronRight, FaCalendarAlt, FaClock, FaUserMd, FaUsers } from 'react-icons/fa';
import './EnhancedDatePicker.css';

export interface DateStatus {
  date: string; // YYYY-MM-DD format
  hasSchedule: boolean;
  hasAppointments: boolean;
  appointmentCount: number;
  totalSlots: number;
  isPast: boolean;
}

interface EnhancedDatePickerProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  dateStatuses: DateStatus[];
  isLoading?: boolean;
  className?: string;
}

const MONTHS = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月'
];

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const EnhancedDatePicker: React.FC<EnhancedDatePickerProps> = ({
  selectedDate,
  onDateChange,
  dateStatuses,
  isLoading = false,
  className = ''
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  
  // Helper function to format date as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  // Get status for a specific date
  const getDateStatus = (date: Date): DateStatus | null => {
    const dateStr = formatDate(date);
    return dateStatuses.find(status => status.date === dateStr) || null;
  };

  // Generate calendar days for current month
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    // First day of the month and how many days in the month
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    // Previous month's trailing days
    const prevMonth = new Date(year, month - 1, 0);
    const prevMonthDays = prevMonth.getDate();
    
    const days: (Date | null)[] = [];
    
    // Add previous month's trailing days
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      days.push(new Date(year, month - 1, prevMonthDays - i));
    }
    
    // Add current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    // Add next month's leading days to fill the grid
    const remainingSlots = 42 - days.length; // 6 rows × 7 days
    for (let day = 1; day <= remainingSlots; day++) {
      days.push(new Date(year, month + 1, day));
    }
    
    return days;
  }, [currentMonth]);

  // Navigate months
  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newMonth = new Date(prev);
      if (direction === 'prev') {
        newMonth.setMonth(prev.getMonth() - 1);
      } else {
        newMonth.setMonth(prev.getMonth() + 1);
      }
      return newMonth;
    });
  };

  // Check if date is today
  const isToday = (date: Date): boolean => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  // Check if date is selected
  const isSelected = (date: Date): boolean => {
    return date.toDateString() === selectedDate.toDateString();
  };

  // Check if date is in current month
  const isCurrentMonth = (date: Date): boolean => {
    return date.getMonth() === currentMonth.getMonth() && date.getFullYear() === currentMonth.getFullYear();
  };

  // Get CSS classes for a date
  const getDateClasses = (date: Date): string => {
    const status = getDateStatus(date);
    const classes = ['enhanced-date-cell'];
    
    if (!isCurrentMonth(date)) {
      classes.push('other-month');
    }
    
    if (isToday(date)) {
      classes.push('today');
    }
    
    if (isSelected(date)) {
      classes.push('selected');
    }
    
    if (status) {
      if (status.isPast) {
        classes.push('past-with-schedule');
      } else if (status.hasSchedule) {
        if (status.hasAppointments) {
          classes.push('future-with-appointments');
        } else {
          classes.push('future-with-schedule');
        }
      }
    }
    
    return classes.join(' ');
  };

  // Handle date click
  const handleDateClick = (date: Date) => {
    if (isCurrentMonth(date)) {
      onDateChange(date);
    }
  };

  // Get status indicator for a date
  const getStatusIndicator = (date: Date) => {
    const status = getDateStatus(date);
    if (!status || !status.hasSchedule) return null;

    return (
      <div className="date-status-indicator">
        {status.isPast ? (
          <div className="status-icon past">
            <FaClock size={8} />
          </div>
        ) : status.hasAppointments ? (
          <div className="status-info">
            <div className="status-icon appointments">
              <FaUsers size={8} />
            </div>
            <span className="appointment-count">{status.appointmentCount}/{status.totalSlots}</span>
          </div>
        ) : (
          <div className="status-icon available">
            <FaUserMd size={8} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`enhanced-date-picker ${className}`}>
      {/* Combined Header with Month Navigation and Selected Date */}
      <div className="combined-header">
        <div className="month-navigation">
          <button 
            onClick={() => navigateMonth('prev')}
            className="nav-button"
            disabled={isLoading}
          >
            <FaChevronLeft />
          </button>
          
          <div className="current-month">
            <span className="month-name">{MONTHS[currentMonth.getMonth()]}</span>
            <span className="year">{currentMonth.getFullYear()}</span>
          </div>
          
          <button 
            onClick={() => navigateMonth('next')}
            className="nav-button"
            disabled={isLoading}
          >
            <FaChevronRight />
          </button>
        </div>

        {/* Selected Date Info - Inline with month navigation */}
        {selectedDate && (
          <div className="selected-date-inline">
            <span className="selected-date-text">
              {selectedDate.getMonth() + 1}/{selectedDate.getDate()}
            </span>
            {(() => {
              const status = getDateStatus(selectedDate);
              if (status && status.hasSchedule) {
                return (
                  <div className="schedule-summary-inline">
                    {status.isPast ? (
                      <span className="past-notice">已過期</span>
                    ) : status.hasAppointments ? (
                      <span className="appointment-notice">
                        {status.appointmentCount}/{status.totalSlots}
                      </span>
                    ) : (
                      <span className="available-notice">可預約</span>
                    )}
                  </div>
                );
              } else {
                return <span className="no-schedule">無排班</span>;
              }
            })()}
          </div>
        )}
      </div>

      {/* Calendar Grid */}
      <div className="calendar-container">
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
            <span>載入中...</span>
          </div>
        )}
        
        {/* Weekday Headers */}
        <div className="weekday-header">
          {WEEKDAYS.map(day => (
            <div key={day} className="weekday-cell">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar Days */}
        <div className="calendar-grid">
          {calendarDays.map((date, index) => {
            if (!date) return <div key={index} className="empty-cell"></div>;
            
            return (
              <div
                key={index}
                className={getDateClasses(date)}
                onClick={() => handleDateClick(date)}
              >
                <span className="date-number">{date.getDate()}</span>
                {getStatusIndicator(date)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EnhancedDatePicker;