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
  patientPhone?: string | null;
  patientGender?: string | null;
  patientDateOfBirth?: string | null;
  patientCredibilityScore?: number | null;
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

  const getCreditColorClass = (score?: number | null): 'credit-good' | 'credit-medium' | 'credit-low' | 'credit-neutral' => {
    if (score == null) return 'credit-neutral';
    if (score >= 15) return 'credit-good';
    if (score >= 10) return 'credit-medium';
    return 'credit-low';
  };

  const getGenderInfo = (gender?: string | null): { text: string; className: 'gender-male' | 'gender-female' | 'gender-other' } => {
    const g = (gender || '').toUpperCase();
    if (g === 'MALE' || g === 'M') return { text: '男', className: 'gender-male' };
    if (g === 'FEMALE' || g === 'F') return { text: '女', className: 'gender-female' };
    return { text: '其他', className: 'gender-other' };
  };

  const calcAgeFromBirthDate = (dateOfBirth?: string | null): number | null => {
    if (!dateOfBirth) return null;
    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  };

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
// 将任何非四状态的值（如旧资料中的 CHECKED_IN）以待就诊的样式显示
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
            预约变更历史记录
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
              <span className="ml-2 text-gray-600">加载中...</span>
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
                <h3 className="text-lg font-medium text-gray-900 mb-3">预约信息</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">预约时间：</span>
                    <span className="font-medium whitespace-nowrap">{appointmentInfo.time}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">当前状态：</span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointmentInfo.status)}`}>
                      {getStatusText(appointmentInfo.status)}
                    </span>
                  </div>
                  <div className="col-span-1 sm:col-span-2">
                    <div className="mobile-patient-item-inline">
                      <div className="mobile-patient-info-inline">
                        <span className="mobile-patient-name-inline">{appointmentInfo.patientName}</span>
                        <div className="flex items-center ml-0 shrink-0 space-x-1">
                          {appointmentInfo.patientPhone && (
                            <a className="phone-inline-badge" href={`tel:${String(appointmentInfo.patientPhone).replace(/\s+/g,'')}`} aria-label={`拨打 ${appointmentInfo.patientPhone}`}>{appointmentInfo.patientPhone}</a>
                          )}
                          <span className={`credit-inline-badge ${getCreditColorClass(appointmentInfo.patientCredibilityScore ?? null)}`}>{typeof appointmentInfo.patientCredibilityScore === 'number' ? appointmentInfo.patientCredibilityScore : '未知'}</span>
                          {(() => { const g = getGenderInfo(appointmentInfo.patientGender ?? undefined); return (<span className={`gender-inline-badge ${g.className}`}>{g.text}</span>); })()}
                          {(() => { const age = calcAgeFromBirthDate(appointmentInfo.patientDateOfBirth ?? undefined); return (<span className="age-inline-badge">{age != null ? `${age}歲` : '年齡未知'}</span>); })()}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">医生：</span>
                    <span className="font-medium">{appointmentInfo.doctorName}</span>
                  </div>
                  {appointmentInfo.reason && (
                    <div className="col-span-1 sm:col-span-2">
                      <span className="text-gray-600">当前原因：</span>
                      <span className="font-medium break-words">{appointmentInfo.reason}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* History Timeline */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">变更历史</h3>
                {history.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">暂无历史记录</p>
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
                            <div className="space-y-1 text-sm leading-tight mb-2">
                              <div className="flex items-start">
                                <span className="text-gray-600 mr-2">操作人：</span>
                                <span className="font-medium text-gray-900 break-words">{record.operatorName}</span>
                              </div>
                              <div className="flex items-start">
                                <span className="text-gray-600 mr-2">动作：</span>
                                <span className="font-medium text-gray-900 break-words">{getActionText(record.action)}</span>
                              </div>
                              <div className="flex items-start">
                                <span className="text-gray-600 mr-2">时间：</span>
                                <span className="font-medium text-gray-900 break-words">{formatDateTime(record.operatedAt)}</span>
                              </div>
                            </div>
                            
                            <div className="space-y-1 text-sm leading-tight">
                              <div className="flex items-center">
                                <span className="text-gray-600 mr-2">状态：</span>
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
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppointmentHistoryModal;