'use client';

import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export default function UsernameBadge() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isAuthPage = !!(pathname && pathname.startsWith('/auth'));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  if (isAuthPage || status !== 'authenticated') return null;
  const uname = (session?.user?.username as string | undefined) || (session?.user?.name as string | undefined) || '';
  if (!uname) return null;
  const role = (session?.user?.role as string | undefined) || '';
  const img = (session?.user?.image as string | undefined) || '';
  const initials = uname.trim().slice(0, 1).toUpperCase();
  const toggle = () => setOpen((v) => !v);
  const close = () => setOpen(false);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div ref={rootRef}>
      <button
        type="button"
        className="username-badge"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {img ? (
          <img src={img} alt="avatar" className="username-avatar" />
        ) : (
          <div className="username-avatar" aria-hidden>{initials}</div>
        )}
        <span className="username-value">{uname}</span>
        {role ? <span className="role-badge">{role}</span> : null}
      </button>
      {open && (
        <div className="user-menu" role="menu">
          <Link href="/settings" className="user-menu-item" role="menuitem" onClick={close}>设置</Link>
          <button className="user-menu-item" role="menuitem" onClick={() => signOut({ redirect: true, callbackUrl: '/auth/signin' })}>退出登录</button>
        </div>
      )}
    </div>
  );
}