'use client';

import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export default function PatientNameBadge() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isAuthPage = !!(pathname && pathname.startsWith('/auth'));
  const isPatient = status === 'authenticated' && session?.user?.role === 'PATIENT';
  const name = (session?.user?.name as string | undefined) || '';
  const img = (session?.user?.image as string | undefined) || '';
  const initials = name.trim().slice(0, 1).toUpperCase();

  if (isAuthPage || !isPatient || !name) return null;

  return (
    <div className="patient-name-badge" aria-label="患者姓名">
      {img ? (
        <img src={img} alt="avatar" className="patient-name-avatar" />
      ) : (
        <div className="patient-name-avatar" aria-hidden>{initials}</div>
      )}
      <span className="patient-name-value">{name}</span>
    </div>
  );
}