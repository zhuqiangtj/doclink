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

const NavItem = ({ href, label, active, Icon, badgeCount }: { href: string; label: string; active: boolean; Icon: React.ElementType; badgeCount?: number }) => {
  return (
    <Link 
      href={href} 
      className={`${styles.navItem} ${active ? styles.navItemActive : styles.navItemInactive}`}
    >
      <Icon className={styles.navIcon} />
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

  useEffect(() => {
    if (session?.user?.role === 'DOCTOR') {
      const fetchUnreadCount = async () => {
        try {
          const res = await fetch('/api/notifications');
          if (res.ok) {
            const data = await res.json();
            setUnreadCount(data.unreadCount || 0);
          }
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

  if (status !== 'authenticated' || !session) {
    return null; // Don't show nav if not logged in
  }

  const role = session.user.role;

  let navItems = [];

  // Define navigation items based on user role
  if (role === 'PATIENT') {
    navItems = [
      { href: '/', label: '首页', Icon: FaHome },
      { href: '/my-appointments', label: '我的预约', Icon: FaCalendarCheck },
      { href: '/my-notifications', label: '通知', Icon: FaBell, badgeCount: unreadCount > 0 ? unreadCount : undefined },
      { href: '/settings', label: '设置', Icon: FaCog },
    ];
  } else if (role === 'DOCTOR') {
    navItems = [
      { href: '/doctor/schedule', label: '排班', Icon: FaCalendarCheck },
      { href: '/doctor/appointments', label: '预约', Icon: FaTachometerAlt, badgeCount: unreadCount > 0 ? unreadCount : undefined },
      { href: '/doctor/rooms', label: '诊室', Icon: FaHospital },
      { href: '/settings', label: '设置', Icon: FaCog },
    ];
  } else if (role === 'ADMIN') {
    navItems = [
      { href: '/admin/dashboard', label: '仪表板', Icon: FaTachometerAlt },
      { href: '/admin/users', label: '用户', Icon: FaUsers },
      { href: '/admin/audit-log', label: '审计日志', Icon: FaClipboardList },
      { href: '/settings', label: '设置', Icon: FaCog },
    ];
  }

  return (
    <nav className={styles.bottomNav}>
      <div className={styles.navContainer}>
        {navItems.map(item => (
          <NavItem key={item.href} href={item.href} label={item.label} active={pathname === item.href} Icon={item.Icon} badgeCount={item.badgeCount} />
        ))}
      </div>
    </nav>
  );
}
