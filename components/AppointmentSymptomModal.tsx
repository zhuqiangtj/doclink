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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-3 border-b border-gray-100 bg-gray-50 shrink-0">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            病情录入 - {appointment.patient.user.name}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-200"
          >
            <FaTimes />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">病情</label>
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none text-sm"
              placeholder="请输入病人病情描述..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">治疗方案</label>
            <textarea
              value={treatmentPlan}
              onChange={(e) => setTreatmentPlan(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none text-sm"
              placeholder="请输入治疗方案..."
            />
          </div>
        </div>

        <div className="p-3 border-t border-gray-100 flex justify-end shrink-0 gap-3 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors font-medium text-sm"
            disabled={isSaving}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                保存中...
              </>
            ) : (
              <>
                <FaSave />
                保存
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
