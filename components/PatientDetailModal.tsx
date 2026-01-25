import React, { useState, useEffect } from 'react';
import { FaTimes, FaUser, FaVenusMars, FaBirthdayCake, FaStar, FaNotesMedical, FaUserSlash, FaCalendarAlt, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { getStatusText } from '../utils/statusText';

interface Appointment {
  id: string;
  date: string;
  time: string;
  status: string;
}

interface PatientData {
  id: string;
  name: string;
  gender: string | null;
  age: number | null;
  phone: string | null;
  credibilityScore: number;
  visitCount: number;
  noShowCount: number;
  totalAppointments: number;
}

interface PatientDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: PatientData | null;
  appointments?: Appointment[];
  onSave?: (patientId: string, newScore: number) => Promise<void>;
}

export default function PatientDetailModal({ isOpen, onClose, patient, appointments = [], onSave }: PatientDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');
  const [historyPage, setHistoryPage] = useState(1);
  const [tempScore, setTempScore] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const itemsPerPage = 5;

  useEffect(() => {
    if (isOpen && patient) {
      setHistoryPage(1);
      setTempScore(patient.credibilityScore);
      setActiveTab('overview');
    }
  }, [isOpen, patient]);

  const handleSave = async () => {
    if (!onSave || !patient) return;
    setIsSaving(true);
    try {
      await onSave(patient.id, tempScore);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !patient) return null;

  const getGenderText = (gender: string | null) => {
    if (!gender) return '未知';
    const g = gender.toUpperCase();
    if (g === 'MALE' || g === 'M') return '男';
    if (g === 'FEMALE' || g === 'F') return '女';
    return '未知';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'text-blue-600 bg-blue-50';
      case 'COMPLETED': return 'text-green-600 bg-green-50';
      case 'CANCELLED': return 'text-gray-600 bg-gray-50';
      case 'NO_SHOW': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const totalPages = Math.ceil((appointments?.length || 0) / itemsPerPage);
  const paginatedAppointments = appointments?.slice(
    (historyPage - 1) * itemsPerPage,
    historyPage * itemsPerPage
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden animate-slideUp max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50 shrink-0">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FaUser className="text-blue-500" />
            病人详细信息
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-200"
          >
            <FaTimes />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-500 text-2xl font-bold shrink-0">
              {patient.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{patient.name}</h2>
              <p className="text-gray-500 text-sm">{patient.phone || '无电话号码'}</p>
            </div>
          </div>

          {/* Tabs Navigation */}
          <div className="flex border-b border-gray-100">
            <button
              className={`flex-1 py-2 text-sm font-medium transition-colors relative ${activeTab === 'overview' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('overview')}
            >
              概览
              {activeTab === 'overview' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>}
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium transition-colors relative ${activeTab === 'history' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('history')}
            >
              预约记录
              {activeTab === 'history' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>}
            </button>
          </div>

          {activeTab === 'overview' && (
            <div className="grid grid-cols-3 gap-3 animate-fadeIn">
              <div className="bg-gray-50 p-2 rounded-lg text-center">
                <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                  <FaVenusMars className="text-pink-400" />
                  <span>性别</span>
                </div>
                <div className="font-semibold text-gray-800 text-sm">{getGenderText(patient.gender)}</div>
              </div>

              <div className="bg-gray-50 p-2 rounded-lg text-center">
                <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                  <FaBirthdayCake className="text-orange-400" />
                  <span>年龄</span>
                </div>
                <div className="font-semibold text-gray-800 text-sm">
                  {patient.age !== null ? `${patient.age} 岁` : '未知'}
                </div>
              </div>

              <div className="bg-gray-50 p-2 rounded-lg text-center">
                <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                  <FaStar className="text-yellow-400" />
                  <span>积分</span>
                </div>
                {onSave ? (
                  <div className="flex items-center justify-center gap-2">
                    <button 
                      onClick={() => setTempScore(s => Math.max(0, s - 1))}
                      className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded text-gray-500 hover:text-blue-500 hover:border-blue-500 disabled:opacity-50 transition-colors text-xl font-bold"
                      disabled={isSaving}
                    >
                      -
                    </button>
                    <input 
                      type="number" 
                      value={tempScore}
                      onChange={(e) => setTempScore(Math.max(0, parseInt(e.target.value) || 0))}
                      className={`w-12 text-center font-semibold text-sm bg-transparent border-b border-gray-300 focus:border-blue-500 focus:outline-none ${tempScore < 60 ? 'text-red-600' : 'text-green-600'}`}
                      disabled={isSaving}
                    />
                    <button 
                      onClick={() => setTempScore(s => s + 1)}
                      className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded text-gray-500 hover:text-blue-500 hover:border-blue-500 disabled:opacity-50 transition-colors text-xl font-bold"
                      disabled={isSaving}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <div className={`font-semibold text-sm ${patient.credibilityScore < 60 ? 'text-red-600' : 'text-green-600'}`}>
                    {patient.credibilityScore}
                  </div>
                )}
              </div>

              <div className="bg-gray-50 p-2 rounded-lg text-center">
                <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                  <FaNotesMedical className="text-blue-400" />
                  <span>看病次数</span>
                </div>
                <div className="font-semibold text-gray-800 text-sm">{patient.visitCount}</div>
              </div>

              <div className="bg-gray-50 p-2 rounded-lg text-center col-span-2">
                <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                  <FaUserSlash className="text-red-400" />
                  <span>爽约次数</span>
                </div>
                <div className="font-semibold text-red-600 text-sm">{patient.noShowCount}</div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="animate-fadeIn">
              {appointments.length > 0 ? (
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">日期</th>
                        <th className="px-3 py-2 font-medium">时间</th>
                        <th className="px-3 py-2 font-medium">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paginatedAppointments.map((apt) => (
                        <tr key={apt.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-700">{apt.date}</td>
                          <td className="px-3 py-2 text-gray-700">{apt.time}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(apt.status)}`}>
                              {getStatusText(apt.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {totalPages > 1 && (
                    <div className="flex justify-between items-center p-2 bg-gray-50 border-t border-gray-100">
                      <button
                        onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                        disabled={historyPage === 1}
                        className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:hover:bg-transparent text-gray-600"
                      >
                        <FaChevronLeft size={12} />
                      </button>
                      <span className="text-xs text-gray-500">
                        {historyPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                        disabled={historyPage === totalPages}
                        className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:hover:bg-transparent text-gray-600"
                      >
                        <FaChevronRight size={12} />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-gray-400 text-sm bg-gray-50 rounded-lg">
                  暂无预约记录
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end shrink-0 gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors font-medium text-sm"
            disabled={isSaving}
          >
            取消
          </button>
          {onSave && (
            <button
              onClick={handleSave}
              disabled={isSaving || tempScore === patient.credibilityScore}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
