'use client';

import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export default function UsernameBadge() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isAuthPage = !!(pathname && pathname.startsWith('/auth'));
  if (isAuthPage || status !== 'authenticated') return null;
  const uname = (session?.user?.username as string | undefined) || (session?.user?.name as string | undefined) || '';
  if (!uname) return null;
  return (
    <div className="username-badge" aria-live="polite" aria-label="当前用户">
      <span className="username-label">用户</span>
      <span className="username-value">{uname}</span>
    </div>
  );
}