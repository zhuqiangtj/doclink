'use client';

import { useSession, getSession } from 'next-auth/react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FaHome, FaBell, FaCalendarCheck, FaCog, FaTachometerAlt, FaHospital, FaUsers, FaClipboardList } from 'react-icons/fa';
import { useState, useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import styles from './BottomNav.module.css';
import { fetchWithTimeout } from '../utils/network';

interface Notification {
  isRead: boolean;
}

const NavItem = ({ href, label, active, Icon, badgeCount, iconColor, onNavigateStart }: { href: string; label: string; active: boolean; Icon: React.ElementType; badgeCount?: number; iconColor?: string; onNavigateStart: (href: string) => void }) => {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onNavigateStart(href);
  };
  return (
    <Link 
      href={href}
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
  const pendingPathRef = useRef<string | null>(null);

  const simplifyStage = (s: string) => {
    const t = s || '';
    if (t.includes('软跳转')) return '软跳转';
    if (t.includes('强制导航') || t.includes('硬跳转')) return '硬跳转';
    if (t.includes('超时')) return '已超时';
    if (t.includes('刷新')) return '刷新';
    if (t.includes('等待')) return '等待';
    if (t.includes('完成')) return '完成';
    if (t.includes('失败')) return '失败';
    return '加载中';
  };

  // 在認證相關頁面（登入/註冊）判斷，於所有 Hooks 之後再決定是否渲染
  const isAuthPage = !!(pathname && pathname.startsWith('/auth'));

  useEffect(() => {
    if (session?.user?.role === 'DOCTOR') {
      const fetchUnreadCount = async () => {
        try {
          const res = await fetchWithTimeout('/api/notifications');
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
      
      const handleNotificationRead = () => {
        fetchUnreadCount();
      };
      
      window.addEventListener('notificationRead', handleNotificationRead);
      let es: EventSource | null = null;
      let retry = 0;
      let stopped = false;
      let timer: any = null;
      (async () => {
        try {
          const userRes = await fetchWithTimeout(`/api/user/${session.user.id}`);
          if (!userRes.ok) return;
          const userData = await userRes.json();
          const doctorId = userData?.doctorProfile?.id as string | undefined;
          if (!doctorId) return;
          const connect = () => {
            if (stopped) return;
            try {
              es = new EventSource(`/api/realtime/subscribe?kind=doctor&id=${doctorId}`);
              es.onmessage = () => { fetchUnreadCount(); };
              es.onerror = () => {
                try { es?.close(); } catch {}
                if (stopped) return;
                retry = Math.min(retry + 1, 5);
                const delay = Math.min(30000, 1000 * Math.pow(2, retry));
                timer = setTimeout(connect, delay);
              };
            } catch {
              retry = Math.min(retry + 1, 5);
              const delay = Math.min(30000, 1000 * Math.pow(2, retry));
              timer = setTimeout(connect, delay);
            }
          };
          connect();
        } catch {}
      })();
      
      return () => {
        clearInterval(interval);
        window.removeEventListener('notificationRead', handleNotificationRead);
        stopped = true;
        if (es) es.close();
        if (timer) clearTimeout(timer);
      };
    } else if (session?.user?.role === 'PATIENT') {
      const fetchUnreadCount = async () => {
        try {
          const res = await fetchWithTimeout('/api/patient-notifications');
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
      const handleNotificationRead = () => {
        fetchUnreadCount();
      };
      window.addEventListener('notificationRead', handleNotificationRead);
      let es: EventSource | null = null;
      let retry = 0;
      let stopped = false;
      let timer: any = null;
      (async () => {
        try {
          const userRes = await fetchWithTimeout(`/api/user/${session.user.id}`);
          if (!userRes.ok) return;
          const userData = await userRes.json();
          const patientId = userData?.patientProfile?.id as string | undefined;
          if (!patientId) return;
          const connect = () => {
            if (stopped) return;
            try {
              es = new EventSource(`/api/realtime/subscribe?kind=patient&id=${patientId}`);
              es.onmessage = () => { fetchUnreadCount(); };
              es.onerror = () => {
                try { es?.close(); } catch {}
                if (stopped) return;
                retry = Math.min(retry + 1, 5);
                const delay = Math.min(30000, 1000 * Math.pow(2, retry));
                timer = setTimeout(connect, delay);
              };
            } catch {
              retry = Math.min(retry + 1, 5);
              const delay = Math.min(30000, 1000 * Math.pow(2, retry));
              timer = setTimeout(connect, delay);
            }
          };
          connect();
        } catch {}
      })();
      return () => {
        clearInterval(interval);
        window.removeEventListener('notificationRead', handleNotificationRead);
        stopped = true;
        if (es) es.close();
        if (timer) clearTimeout(timer);
      };
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
    if (navLoading) return;
    setNavLoading(true);
    setNavStages(['准备导航', '开始软跳转']);
    setPendingPath(href);
    pendingPathRef.current = href;
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
    // 二次软跳转重试：模拟再次点击，缓解偶发不触发路由变更的情况
    window.setTimeout(() => {
      try {
        const target = pendingPathRef.current || href;
        if (normalizePath(window.location.pathname) !== normalizePath(target)) {
          router.push(target);
          setNavStages(prev => [...prev, '软跳转重试']);
        }
      } catch {}
    }, 400);
    // Watchdog：逐步升级硬跳转，避免长时间卡住
    hardStageRef.current = 'none';
    hardTimeoutRef.current = window.setTimeout(() => {
      const target = pendingPathRef.current || href;
      if (hardStageRef.current === 'none' && normalizePath(window.location.pathname) !== normalizePath(target)) {
        setNavStages(prev => [...prev, '软跳转超时(1200ms)，硬跳转(assign)']);
        try {
          window.location.assign(target);
          hardStageRef.current = 'assign';
        } catch {
          router.replace(target);
        }
      }
    }, 1200);

    watchdogStartRef.current = Date.now();
    watchdogIntervalRef.current = window.setInterval(() => {
      const target = pendingPathRef.current || href;
      if (!target || normalizePath(window.location.pathname) === normalizePath(target)) {
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
          window.location.replace(target);
          hardStageRef.current = 'replace';
        } catch {}
      } else if (elapsed >= 10000 && hardStageRef.current !== 'href') {
        setNavStages(prev => [...prev, '路径未变更(10s)，最终强制导航(href)']);
        try {
          (window as any).location.href = target;
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

  type NavCfg = { href: string; label: string; Icon: React.ElementType; badgeCount?: number; iconColor?: string };
  let navItems: NavCfg[] = [];

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
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            active={normalizePath(pathname) === normalizePath(item.href)}
            Icon={item.Icon}
            badgeCount={item.badgeCount}
            iconColor={item.iconColor}
            onNavigateStart={beginNavigation}
          />
        ))}
      </div>
      {navLoading && typeof document !== 'undefined' && createPortal(
        (
          <div className={styles.navOverlay} role="alert" aria-live="polite">
            <div className={styles.navOverlayBox}>
              <span className={styles.navSpinner} aria-hidden="true" />
              <div className={styles.navStages}>
                <div className={styles.navStageCurrent}>{simplifyStage(navStages[navStages.length - 1] || '')}</div>
              </div>
            </div>
          </div>
        ),
        document.body
      )}
    </nav>
  );
}
