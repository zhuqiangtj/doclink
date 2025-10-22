'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Define icons here or import them
// For simplicity, we'll use text labels

const NavItem = ({ href, label, active }: { href: string; label: string; active: boolean }) => (
  <Link href={href} className={`flex flex-col items-center justify-center w-full text-xs ${active ? 'text-indigo-600' : 'text-gray-500'}`}>
    {/* Icon would go here */}
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
      { href: '/', label: 'Home' },
      { href: '/my-appointments', label: 'My Appointments' },
      { href: '/settings', label: 'Settings' },
    ];
  } else if (role === 'DOCTOR') {
    navItems = [
      { href: '/doctor/schedule', label: 'Dashboard' },
      { href: '/doctor/book-appointment', label: 'Book for Patient' },
      { href: '/doctor/rooms', label: 'Rooms' }, // New: Doctor's own room management
      { href: '/settings', label: 'Settings' },
    ];
  } else if (role === 'ADMIN') {
    navItems = [
      { href: '/admin/dashboard', label: 'Dashboard' }, // New: Admin Dashboard
      { href: '/admin/users', label: 'Users' }, // New: Admin User Management
      { href: '/admin/audit-log', label: 'Audit Log' }, // New: Audit Log
      { href: '/settings', label: 'Settings' },
    ];
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 flex justify-around items-center z-50">
      {navItems.map(item => (
        <NavItem key={item.href} href={item.href} label={item.label} active={pathname === item.href} />
      ))}
    </nav>
  );
}
