'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FaHome, FaCalendarCheck, FaCog, FaTachometerAlt, FaUserPlus, FaHospital, FaUsers, FaClipboardList } from 'react-icons/fa';

const NavItem = ({ href, label, active, Icon }: { href: string; label: string; active: boolean; Icon: React.ElementType }) => (
  <Link href={href} className={`flex flex-col items-center justify-center w-full text-xs ${active ? 'text-indigo-600' : 'text-gray-500'}`}>
    <Icon className="text-lg" />
    <span>{label}</span>
  </Link>
);

export default function BottomNav() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  if (status !== 'authenticated') {
    return null; // Don't show nav if not logged in
  }

  const role = session.user.role;

  let navItems = [];

  // Define navigation items based on user role
  if (role === 'PATIENT') {
    navItems = [
      { href: '/', label: 'Home', Icon: FaHome },
      { href: '/my-appointments', label: 'My Appointments', Icon: FaCalendarCheck },
      { href: '/settings', label: 'Settings', Icon: FaCog },
    ];
  } else if (role === 'DOCTOR') {
    navItems = [
      { href: '/doctor/schedule', label: 'Dashboard', Icon: FaTachometerAlt },
      { href: '/doctor/book-appointment', label: 'Book for Patient', Icon: FaUserPlus },
      { href: '/doctor/rooms', label: 'Rooms', Icon: FaHospital },
      { href: '/settings', label: 'Settings', Icon: FaCog },
    ];
  } else if (role === 'ADMIN') {
    navItems = [
      { href: '/admin/dashboard', label: 'Dashboard', Icon: FaTachometerAlt },
      { href: '/admin/users', label: 'Users', Icon: FaUsers },
      { href: '/admin/audit-log', label: 'Audit Log', Icon: FaClipboardList },
      { href: '/settings', label: 'Settings', Icon: FaCog },
    ];
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 flex justify-around items-center z-50">
      {navItems.map(item => (
        <NavItem key={item.href} href={item.href} label={item.label} active={pathname === item.href} Icon={item.Icon} />
      ))}
    </nav>
  );
}
