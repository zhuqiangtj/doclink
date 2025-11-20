'use client';

import { useSession, getSession } from 'next-auth/react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FaHome, FaBell, FaCalendarCheck, FaCog, FaTachometerAlt, FaHospital, FaUsers, FaClipboardList } from 'react-icons/fa';
import { useState, useEffect, useRef } from 'react';
import styles from './BottomNav.module.css';

interface Notification {
  isRead: boolean;
}

const NavItem = ({ href, label, active, Icon, badgeCount, iconColor, onNavigateStart }: { href: string; label: string; active: boolean; Icon: React.ElementType; badgeCount?: number; iconColor?: string; onNavigateStart: (href: string) => void }) => {
  const handleClick = () => {
    onNavigateStart(href);
  };
  return (
    <Link 
      href={href}
      prefetch={false}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`${styles.navItem} ${active ? styles.navItemActive : styles.navItemInactive}`}
      onClick={handleClick}
    >
      <Icon className={styles.navIcon} style={{ color: active ? iconColor : undefined }} />
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
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [navLoading, setNavLoading] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [navStages, setNavStages] = useState<string[]>([]);
  const normalizePath = (p: string) => (p || '').replace(/\/$/, '');
  const sessionRefreshTimeoutMs = 800;
  const hardTimeoutRef = useRef<number | null>(null);
  const watchdogIntervalRef = useRef<number | null>(null);
  const watchdogStartRef = useRef<number | null>(null);
  const hardStageRef = useRef<'none' | 'assign' | 'replace' | 'href'>('none');

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

  useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        await getSession();
        router.refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [router]);

  useEffect(() => {
    const onFocus = async () => {
      await getSession();
      router.refresh();
    };
    const onOnline = async () => {
      await getSession();
      router.refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [router]);

  useEffect(() => {
    if (!pendingPath) return;
    if (normalizePath(pathname) === normalizePath(pendingPath)) {
      setNavStages(prev => [...prev, '软跳转完成', '刷新页面']);
      if (hardTimeoutRef.current) {
        clearTimeout(hardTimeoutRef.current);
        hardTimeoutRef.current = null;
      }
      if (watchdogIntervalRef.current) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
        watchdogStartRef.current = null;
        hardStageRef.current = 'none';
      }
      router.refresh();
      setTimeout(() => {
        setNavStages(prev => [...prev, '完成']);
        setNavLoading(false);
        setPendingPath(null);
        setNavStages([]);
      }, 300);
    }
  }, [pathname, pendingPath, router]);

  const beginNavigation = async (href: string) => {
    setNavLoading(true);
    setNavStages(['准备导航', '开始软跳转']);
    setPendingPath(href);
    router.push(href);
    setNavStages(prev => [...prev, navigator.onLine ? '刷新会话(后台)' : '离线，跳过会话刷新']);
    if (navigator.onLine) {
      let finished = false;
      const sessionRace = new Promise<'完成' | '超时' | '失败'>(resolve => {
        getSession()
          .then(() => {
            if (!finished) {
              finished = true;
              resolve('完成');
            }
          })
          .catch(() => {
            if (!finished) {
              finished = true;
              resolve('失败');
            }
          });
        setTimeout(() => {
          if (!finished) {
            finished = true;
            resolve('超时');
          }
        }, sessionRefreshTimeoutMs);
      });
      sessionRace.then(state => {
        if (state === '完成') setNavStages(prev => [...prev, '会话刷新完成']);
        else if (state === '超时') setNavStages(prev => [...prev, `会话刷新超时(${sessionRefreshTimeoutMs}ms)`]);
        else setNavStages(prev => [...prev, '会话刷新失败']);
      });
    }
    setNavStages(prev => [...prev, '等待路径变化']);
    // Watchdog：逐步升级硬跳转，避免长时间卡住
    hardStageRef.current = 'none';
    hardTimeoutRef.current = window.setTimeout(() => {
      if (pendingPath && hardStageRef.current === 'none') {
        setNavStages(prev => [...prev, '软跳转超时(1200ms)，硬跳转(assign)']);
        try {
          window.location.assign(href);
          hardStageRef.current = 'assign';
        } catch {
          router.refresh();
        }
      }
    }, 1200);

    watchdogStartRef.current = Date.now();
    watchdogIntervalRef.current = window.setInterval(() => {
      if (!pendingPath || normalizePath(window.location.pathname) === normalizePath(pendingPath)) {
        if (watchdogIntervalRef.current) {
          clearInterval(watchdogIntervalRef.current);
          watchdogIntervalRef.current = null;
          watchdogStartRef.current = null;
          hardStageRef.current = 'none';
        }
        return;
      }
      const elapsed = (Date.now() - (watchdogStartRef.current || Date.now()));
      if (elapsed >= 5000 && hardStageRef.current !== 'replace') {
        setNavStages(prev => [...prev, '路径未变更(5s)，硬跳转(replace)']);
        try {
          window.location.replace(href);
          hardStageRef.current = 'replace';
        } catch {}
      } else if (elapsed >= 10000 && hardStageRef.current !== 'href') {
        setNavStages(prev => [...prev, '路径未变更(10s)，最终强制导航(href)']);
        try {
          (window as any).location.href = href;
          hardStageRef.current = 'href';
        } catch {}
      }
    }, 1000);
  };

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
          <NavItem key={item.href} href={item.href} label={item.label} active={pathname === item.href} Icon={item.Icon} badgeCount={item.badgeCount} iconColor={item.iconColor} onNavigateStart={beginNavigation} />
        ))}
      </div>
      {navLoading && typeof document !== 'undefined' && createPortal(
        (
          <div className={styles.navOverlay} role="alert" aria-live="polite">
            <div className={styles.navOverlayBox}>
              <span className={styles.navSpinner} aria-hidden="true" />
              <div className={styles.navStages}>
                <div className={styles.navStageCurrent}>{navStages[navStages.length - 1] || '加载中…'}</div>
                {navStages.length > 1 && (
                  <div className={styles.navStagePrev}>{navStages.slice(0, -1).join(' ・ ')}</div>
                )}
              </div>
            </div>
          </div>
        ),
        document.body
      )}
    </nav>
  );
}
