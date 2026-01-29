'use client';

import { useState, useEffect } from 'react';
import { FaSave, FaTimes } from 'react-icons/fa';

interface AppointmentSymptomModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: {
    id: string;
    patient: { user: { name: string } };
    symptoms?: string | null;
    treatmentPlan?: string | null;
  } | null;
  onSave: (appointmentId: string, symptoms: string, treatmentPlan: string) => Promise<void>;
}

export default function AppointmentSymptomModal({
  isOpen,
  onClose,
  appointment,
  onSave
}: AppointmentSymptomModalProps) {
  const [symptoms, setSymptoms] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && appointment) {
      setSymptoms(appointment.symptoms || '');
      setTreatmentPlan(appointment.treatmentPlan || '');
    }
  }, [isOpen, appointment]);

  if (!isOpen || !appointment) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(appointment.id, symptoms, treatmentPlan);
      onClose();
    } catch (error) {
      console.error('Failed to save symptoms:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-blue-600 px-4 py-3 flex justify-between items-center text-white">
          <h3 className="font-semibold text-lg">病情录入 - {appointment.patient.user.name}</h3>
          <button onClick={onClose} className="hover:text-blue-200 transition-colors">
            <FaTimes size={20} />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">病情</label>
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              placeholder="请输入病人病情描述..."
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">治疗方案</label>
            <textarea
              value={treatmentPlan}
              onChange={(e) => setTreatmentPlan(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              placeholder="请输入治疗方案..."
            />
          </div>
        </div>

        <div className="px-4 py-3 bg-gray-50 flex justify-end space-x-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            disabled={isSaving}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                保存中...
              </>
            ) : (
              <>
                <FaSave className="mr-2" />
                保存
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
