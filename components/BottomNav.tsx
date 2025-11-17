'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FaHome, FaBell, FaCalendarCheck, FaCog, FaTachometerAlt, FaHospital, FaUsers, FaClipboardList } from 'react-icons/fa';
import { useState, useEffect } from 'react';
import styles from './BottomNav.module.css';

interface Notification {
  isRead: boolean;
}

const NavItem = ({ href, label, active, Icon, badgeCount, iconColor }: { href: string; label: string; active: boolean; Icon: React.ElementType; badgeCount?: number; iconColor?: string }) => {
  return (
    <Link 
      href={href} 
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`${styles.navItem} ${active ? styles.navItemActive : styles.navItemInactive}`}
    >
      <Icon className={styles.navIcon} style={{ color: iconColor }} />
      <span className={styles.navLabel}>{label}</span>
      {badgeCount && badgeCount > 0 && (
        <span className={styles.badge}>{badgeCount}</span>
      )}
    </Link>
  );
};

export default function BottomNav() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  // 在認證相關頁面（登入/註冊）判斷，於所有 Hooks 之後再決定是否渲染
  const isAuthPage = !!(pathname && pathname.startsWith('/auth'));

  useEffect(() => {
    if (session?.user?.role === 'DOCTOR') {
      const fetchUnreadCount = async () => {
        try {
          const res = await fetch('/api/notifications');
          if (!res.ok) {
            setUnreadCount(0);
            return;
          }
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            setUnreadCount(0);
            return;
          }
          const data = await res.json();
          setUnreadCount(data.unreadCount || 0);
        } catch (error) {
          console.error('Failed to fetch unread count:', error);
        }
      };
      fetchUnreadCount();
      const interval = setInterval(fetchUnreadCount, 60000);
      
      // 監聽通知已讀事件
      const handleNotificationRead = () => {
        fetchUnreadCount();
      };
      
      window.addEventListener('notificationRead', handleNotificationRead);
      
      return () => {
        clearInterval(interval);
        window.removeEventListener('notificationRead', handleNotificationRead);
      };
    } else if (session?.user?.role === 'PATIENT') {
      const fetchUnreadCount = async () => {
        try {
          const res = await fetch('/api/patient-notifications');
          if (!res.ok) {
            setUnreadCount(0);
            return;
          }
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            setUnreadCount(0);
            return;
          }
          const notifications: Notification[] = await res.json();
          const count = notifications.filter(n => !n.isRead).length;
          setUnreadCount(count);
        } catch (error) {
          console.error('Failed to fetch patient notification count:', error);
        }
      };
      fetchUnreadCount();
      const interval = setInterval(fetchUnreadCount, 60000);
      return () => clearInterval(interval);
    }
  }, [session]);

  if (status === 'loading') {
    return null; // Don't show nav while loading
  }

  if (isAuthPage || status !== 'authenticated' || !session) {
    return null; // Don't show nav if not logged in
  }

  const role = session.user.role;

  let navItems = [];

  // Define navigation items based on user role
  if (role === 'PATIENT') {
    navItems = [
      { href: '/', label: '首页', Icon: FaHome, iconColor: '#2563eb' },
      { href: '/my-appointments', label: '我的预约', Icon: FaCalendarCheck, iconColor: '#059669' },
      { href: '/my-notifications', label: '通知', Icon: FaBell, badgeCount: unreadCount > 0 ? unreadCount : undefined, iconColor: '#f59e0b' },
      { href: '/settings', label: '设置', Icon: FaCog, iconColor: '#7c3aed' },
    ];
  } else if (role === 'DOCTOR') {
    navItems = [
      { href: '/doctor/schedule', label: '排班', Icon: FaCalendarCheck, iconColor: '#4f46e5' },
      { href: '/doctor/appointments', label: '预约', Icon: FaTachometerAlt, badgeCount: unreadCount > 0 ? unreadCount : undefined, iconColor: '#14b8a6' },
      { href: '/doctor/rooms', label: '诊室', Icon: FaHospital, iconColor: '#ef4444' },
      { href: '/settings', label: '设置', Icon: FaCog, iconColor: '#7c3aed' },
    ];
  } else if (role === 'ADMIN') {
    navItems = [
      { href: '/admin/dashboard', label: '仪表板', Icon: FaTachometerAlt, iconColor: '#06b6d4' },
      { href: '/admin/users', label: '用户', Icon: FaUsers, iconColor: '#2563eb' },
      { href: '/admin/audit-log', label: '审计日志', Icon: FaClipboardList, iconColor: '#f59e0b' },
      { href: '/settings', label: '设置', Icon: FaCog, iconColor: '#7c3aed' },
    ];
  }

  return (
    <nav className={styles.bottomNav}>
      <div className={styles.navContainer}>
        {navItems.map(item => (
          <NavItem key={item.href} href={item.href} label={item.label} active={pathname === item.href} Icon={item.Icon} badgeCount={item.badgeCount} iconColor={item.iconColor} />
        ))}
      </div>
    </nav>
  );
}
