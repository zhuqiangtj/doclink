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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const uname = (session?.user?.username as string | undefined) || (session?.user?.name as string | undefined) || '';
  const role = (session?.user?.role as string | undefined) || '';
  const img = (session?.user?.image as string | undefined) || '';
  const initials = uname.trim().slice(0, 1).toUpperCase();
  const toggle = () => setOpen((v) => !v);
  const close = () => setOpen(false);
  const roleText = role === 'DOCTOR' ? '医生' : role === 'PATIENT' ? '患者' : role === 'ADMIN' ? '管理员' : role;
  const openConfirm = () => { setOpen(false); setConfirmOpen(true); };
  const closeConfirm = () => { if (confirmLoading) return; setConfirmOpen(false); };
  const doSignOut = async () => { if (confirmLoading) return; setConfirmLoading(true); try { await signOut({ redirect: true, callbackUrl: '/auth/signin' }); } finally { setConfirmLoading(false); setConfirmOpen(false); } };
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
  if (isAuthPage || status !== 'authenticated') return null;
  if (!uname) return null;
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
        {role ? <span className="role-badge">{roleText}</span> : null}
      </button>
      {open && (
        <div className="user-menu" role="menu">
          <Link href="/settings" className="user-menu-item" role="menuitem" onClick={close}>设置</Link>
          <button className="user-menu-item" role="menuitem" onClick={openConfirm}>退出登录</button>
        </div>
      )}
      {confirmOpen && (
        <div className="logout-dialog-overlay" onClick={(e) => { if (e.currentTarget === e.target) { if (!confirmLoading) setConfirmOpen(false); } }}>
          <div className="logout-dialog" role="dialog" aria-modal="true">
            <div className="logout-dialog-header">
              <h3 className="logout-dialog-title">确认退出登录</h3>
              <button onClick={closeConfirm} className="logout-dialog-close" disabled={confirmLoading}>×</button>
            </div>
            <div className="logout-dialog-content">
              <p className="logout-dialog-message">是否以 {roleText} 身份退出登录（{uname}）？</p>
            </div>
            <div className="logout-dialog-actions">
              <button onClick={closeConfirm} className="logout-dialog-btn logout-dialog-btn-cancel" disabled={confirmLoading}>取消</button>
              <button onClick={doSignOut} className="logout-dialog-btn logout-dialog-btn-danger" disabled={confirmLoading} aria-busy={confirmLoading}>确认退出</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
