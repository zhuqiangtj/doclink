'use client';

import React, { useState, useEffect } from 'react';
import { getStatusText, getActionText } from '../utils/statusText';
import { IoClose, IoTime, IoPerson, IoDocument, IoList } from 'react-icons/io5';

interface AppointmentHistoryRecord {
  id: string;
  operatorName: string;
  operatedAt: string;
  status: string;
  reason?: string;
  action: string;
}

interface AppointmentInfo {
  id: string;
  time: string;
  status: string;
  reason?: string;
  patientName: string;
  doctorName: string;
  createTime: string;
}

interface AppointmentHistoryModalProps {
  appointmentId: string;
  isOpen: boolean;
  onClose: () => void;
}

const AppointmentHistoryModal: React.FC<AppointmentHistoryModalProps> = ({
  appointmentId,
  isOpen,
  onClose
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointmentInfo, setAppointmentInfo] = useState<AppointmentInfo | null>(null);
  const [history, setHistory] = useState<AppointmentHistoryRecord[]>([]);

  useEffect(() => {
    if (isOpen && appointmentId) {
      fetchHistory();
    }
  }, [isOpen, appointmentId]);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/history`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch appointment history');
      }
      
      const data = await response.json();
      setAppointmentInfo(data.appointment);
      setHistory(data.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'text-yellow-600 bg-yellow-100';
      case 'COMPLETED': return 'text-green-600 bg-green-100';
      case 'CANCELLED': return 'text-red-600 bg-red-100';
      case 'NO_SHOW': return 'text-gray-600 bg-gray-100';
      // 將任何非四狀態的值（如舊資料中的 CHECKED_IN）以待就診的樣式顯示
      default: return 'text-yellow-600 bg-yellow-100';
    }
  };

  // 狀態文字使用統一工具

  // 動作文字使用統一工具

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full mx-2 sm:mx-4 max-w-full sm:max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <IoList className="mr-2 h-5 w-5" />
            預約變更歷史記錄
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <IoClose className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-2 text-gray-600">載入中...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          {appointmentInfo && !loading && !error && (
            <>
              {/* Appointment Info */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h3 className="text-lg font-medium text-gray-900 mb-3">預約信息</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">預約時間：</span>
                    <span className="font-medium whitespace-nowrap">{appointmentInfo.time}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">當前狀態：</span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointmentInfo.status)}`}>
                      {getStatusText(appointmentInfo.status)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">病人：</span>
                    <span className="font-medium">{appointmentInfo.patientName}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">醫生：</span>
                    <span className="font-medium">{appointmentInfo.doctorName}</span>
                  </div>
                  {appointmentInfo.reason && (
                    <div className="col-span-1 sm:col-span-2">
                      <span className="text-gray-600">當前原因：</span>
                      <span className="font-medium break-words">{appointmentInfo.reason}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* History Timeline */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">變更歷史</h3>
                {history.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">暫無歷史記錄</p>
                ) : (
                  <div className="space-y-4">
                    {history.map((record, index) => (
                      <div key={record.id} className="relative">
                        {/* Timeline line */}
                        {index < history.length - 1 && (
                          <div className="absolute left-4 top-8 w-0.5 h-full bg-gray-200"></div>
                        )}
                        
                        {/* Timeline item */}
                        <div className="flex items-start space-x-4">
                          <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                            <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
                          </div>
                          
                          <div className="flex-1 bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-2">
                                <IoPerson className="h-4 w-4 text-gray-500" />
                                <span className="font-medium text-gray-900">{record.operatorName}</span>
                                <span className="text-gray-500">•</span>
                                <span className="text-sm text-gray-600">{getActionText(record.action)}</span>
                              </div>
                              <div className="flex items-center text-sm text-gray-500 whitespace-nowrap">
                                <IoTime className="h-4 w-4 mr-1" />
                                {formatDateTime(record.operatedAt)}
                              </div>
                            </div>
                            
                            <div className="space-y-1 text-sm leading-tight">
                              <div className="flex items-center">
                                <span className="text-gray-600 mr-2">狀態：</span>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(record.status)}`}>
                                  {getStatusText(record.status)}
                                </span>
                              </div>

                              {record.reason && (
                                <div className="flex items-start">
                                  <span className="text-gray-600 mr-2">原因：</span>
                                  <span className="font-medium break-words">{record.reason}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 sm:p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppointmentHistoryModal;