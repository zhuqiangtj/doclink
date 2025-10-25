'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FaHome, FaBell, FaCalendarCheck, FaCog, FaTachometerAlt, FaHospital, FaUsers, FaClipboardList } from 'react-icons/fa';
import { useState, useEffect } from 'react';

interface Notification {
  isRead: boolean;
}

const NavItem = ({ href, label, active, Icon, badgeCount }: { href: string; label: string; active: boolean; Icon: React.ElementType; badgeCount?: number }) => (
  <Link href={href} className={`relative flex flex-col items-center justify-center w-full text-sm transition-colors duration-200 ${active ? 'text-primary' : 'text-gray-500 hover:text-primary'}`}>
    <Icon className="text-2xl mb-1" />
    <span>{label}</span>
    {badgeCount > 0 && (
      <span className="absolute top-0 right-4 px-2 py-1 text-xs font-bold text-white bg-red-500 rounded-full">
        {badgeCount}
      </span>
    )}
  </Link>
);

export default function BottomNav() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (session?.user?.role === 'DOCTOR') {
      const fetchUnreadCount = async () => {
        try {
          const res = await fetch('/api/notifications');
          const data = await res.json();
          setUnreadCount(data.unreadCheckInCount || 0);
        } catch (error) {
          console.error('Failed to fetch doctor notification count:', error);
        }
      };
      fetchUnreadCount();
      const interval = setInterval(fetchUnreadCount, 60000);
      return () => clearInterval(interval);
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
      { href: '/my-notifications', label: '通知', Icon: FaBell, badgeCount: unreadCount },
      { href: '/settings', label: '设置', Icon: FaCog },
    ];
  } else if (role === 'DOCTOR') {
    navItems = [
      { href: '/doctor/schedule', label: '排班', Icon: FaTachometerAlt },
      { href: '/doctor/appointments', label: '预约', Icon: FaCalendarCheck },
      { href: '/doctor/notifications', label: '通知', Icon: FaBell, badgeCount: unreadCount },
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
    <nav className="fixed bottom-0 left-0 right-0 h-20 bg-white border-t border-gray-200 flex justify-around items-center z-50 shadow-t-lg">
      {navItems.map(item => (
        <NavItem key={item.href} href={item.href} label={item.label} active={pathname === item.href} Icon={item.Icon} badgeCount={item.badgeCount} />
      ))}
    </nav>
  );
}
