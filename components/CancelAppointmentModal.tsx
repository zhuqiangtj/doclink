import React from 'react';

type AppointmentInfo = {
  patientName: string;
  credibilityScore?: number | null;
  date: string;
  time: string;
  roomName: string;
};

interface CancelAppointmentModalProps {
  isOpen: boolean;
  info: AppointmentInfo | null;
  onClose: () => void;
  onConfirm: () => void;
  isProcessing?: boolean;
}

export default function CancelAppointmentModal({ isOpen, info, onClose, onConfirm, isProcessing = false }: CancelAppointmentModalProps) {
  if (!isOpen || !info) return null;

  return (
    <div className="mobile-dialog-overlay" aria-modal="true" role="dialog">
      <div className="mobile-dialog">
        <div className="mobile-dialog-header">
          <h3 className="mobile-dialog-title">确认取消预约</h3>
          <button 
            onClick={onClose} 
            className="mobile-dialog-close-btn mobile-dialog-close" 
            aria-label="关闭" 
            disabled={isProcessing}
          >
            ×
          </button>
        </div>
        <div className="mobile-dialog-content">
          <p className="mobile-dialog-text">将取消 {info.patientName} 的预约。</p>
          <div className="mobile-dialog-details mobile-dialog-appointment-info">
            <div className="mobile-dialog-detail-row mobile-dialog-info-row">
              <span className="mobile-dialog-detail-label mobile-dialog-label">日期</span>
              <span className="mobile-dialog-detail-value mobile-dialog-value">{info.date}</span>
            </div>
            <div className="mobile-dialog-detail-row mobile-dialog-info-row">
              <span className="mobile-dialog-detail-label mobile-dialog-label">时间</span>
              <span className="mobile-dialog-detail-value mobile-dialog-value">{info.time}</span>
            </div>
            <div className="mobile-dialog-detail-row mobile-dialog-info-row">
              <span className="mobile-dialog-detail-label mobile-dialog-label">诊室</span>
              <span className="mobile-dialog-detail-value mobile-dialog-value">{info.roomName}</span>
            </div>
            <div className="mobile-dialog-detail-row mobile-dialog-info-row">
              <span className="mobile-dialog-detail-label mobile-dialog-label">病人信用分</span>
              <span className="mobile-dialog-detail-value mobile-dialog-value">{info.credibilityScore ?? '—'}</span>
            </div>
          </div>
          <div className="mobile-dialog-actions">
            <button 
              onClick={onClose} 
              className="mobile-dialog-cancel-btn" 
              disabled={isProcessing}
            >
              取消
            </button>
            <button 
              onClick={onConfirm} 
              className="mobile-dialog-confirm-btn" 
              disabled={isProcessing}
            >
              {isProcessing ? '处理中...' : '确认取消'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}