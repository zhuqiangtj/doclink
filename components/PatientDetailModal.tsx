import React from 'react';
import { FaTimes, FaUser, FaVenusMars, FaBirthdayCake, FaStar, FaNotesMedical, FaUserSlash } from 'react-icons/fa';

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
}

export default function PatientDetailModal({ isOpen, onClose, patient }: PatientDetailModalProps) {
  if (!isOpen || !patient) return null;

  const getGenderText = (gender: string | null) => {
    if (!gender) return '未知';
    if (gender === 'MALE') return '男';
    if (gender === 'FEMALE') return '女';
    return gender;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden animate-slideUp">
        <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50">
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

        <div className="p-6 space-y-4">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-500 text-2xl font-bold">
              {patient.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{patient.name}</h2>
              <p className="text-gray-500 text-sm">{patient.phone || '无电话号码'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                <FaVenusMars className="text-pink-400" />
                <span>性别</span>
              </div>
              <div className="font-semibold text-gray-800">{getGenderText(patient.gender)}</div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                <FaBirthdayCake className="text-orange-400" />
                <span>年龄</span>
              </div>
              <div className="font-semibold text-gray-800">
                {patient.age !== null ? `${patient.age} 岁` : '未知'}
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                <FaStar className="text-yellow-400" />
                <span>积分</span>
              </div>
              <div className={`font-semibold ${patient.credibilityScore < 60 ? 'text-red-600' : 'text-green-600'}`}>
                {patient.credibilityScore}
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                <FaNotesMedical className="text-blue-400" />
                <span>看病次数</span>
              </div>
              <div className="font-semibold text-gray-800">{patient.visitCount}</div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg col-span-2">
              <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                <FaUserSlash className="text-red-400" />
                <span>爽约次数</span>
              </div>
              <div className="font-semibold text-red-600">{patient.noShowCount}</div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors font-medium"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
