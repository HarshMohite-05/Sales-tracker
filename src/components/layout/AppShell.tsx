'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  FileSpreadsheet,
  ShoppingCart,
  TrendingUp,
  FileBarChart,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  Plus,
  ShieldAlert,
  CheckCircle,
  Clock,
  ChevronRight,
  ExternalLink,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Activity,
  Sun,
} from 'lucide-react';
import AddClientModal from '../modals/AddClientModal';
import { claimThisDevice, releaseThisDevice } from '@/lib/pushDevice';

interface AppShellProps {
  children: React.ReactNode;
  // Dark pages (the sales dashboard) get a dark top bar and a wider content area
  theme?: 'light' | 'dark';
}

export default function AppShell({ children, theme = 'light' }: AppShellProps) {
  const dark = theme === 'dark';
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem('crm-sidebar-collapsed') === 'true'); } catch {}
  }, []);
  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem('crm-sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  }
  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileMenuOpen(false); setShowNotifications(false); }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobileMenuOpen]);
  const [user, setUser] = useState<{ id: string; name: string; email: string; role: 'DIRECTOR' | 'SALESPERSON' } | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const accountIdentity = useRef<string | null>(null);

  // Fetch current user and notifications
  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          const identity = `${data.user.id}:${data.user.role}`;
          if (accountIdentity.current && accountIdentity.current !== identity) {
            window.location.reload();
            return;
          }
          accountIdentity.current = identity;
          setUser(data.user);
        } else {
          router.push('/login');
        }
      } catch {
        router.push('/login');
      }
    }
    loadUser();
    const checkVisibleAccount = () => { if (document.visibilityState === 'visible') loadUser(); };
    const onSessionChange = (event: StorageEvent) => {
      if (event.key === 'crm-session-changed') window.location.reload();
    };
    window.addEventListener('focus', checkVisibleAccount);
    document.addEventListener('visibilitychange', checkVisibleAccount);
    window.addEventListener('storage', onSessionChange);
    return () => {
      window.removeEventListener('focus', checkVisibleAccount);
      document.removeEventListener('visibilitychange', checkVisibleAccount);
      window.removeEventListener('storage', onSessionChange);
    };
  }, [router]);

  useEffect(() => {
    async function loadNotifications() {
      try {
        const res = await fetch('/api/notifications');
        if (res.ok) {
          const data = await res.json();
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
        }
      } catch {}
    }
    if (user) {
      loadNotifications();
      const interval = setInterval(loadNotifications, 60000); // refresh every minute
      return () => clearInterval(interval);
    }
  }, [user]);

  async function handleLogout() {
    try {
      // This person's notifications stop coming to this browser once they sign out
      await releaseThisDevice();
      await fetch('/api/auth/logout', { method: 'POST' });
      try { localStorage.setItem('crm-session-changed', crypto.randomUUID()); } catch {}
      router.push('/login');
    } catch {}
  }

  // Notifications turned on in this browser come to whoever is signed in here
  useEffect(() => {
    if (user?.id) claimThisDevice();
  }, [user?.id]);

  // A notification opens the page it is about and counts as read
  async function openNotification(n: any) {
    setShowNotifications(false);
    if (!n.isRead) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationId: n.id }) }).catch(() => undefined);
    }
    if (n.link) router.push(n.link);
  }

  async function markAllNotificationsRead() {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {}
  }

  // Navigation Links
  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, group: 'Workspace' },
    { name: 'Clients', href: '/clients', icon: Users, group: 'Workspace' },
    { name: 'Team Activity', href: '/team-activity', icon: Activity, group: 'Workspace', directorOnly: true },
    { name: 'Quotations', href: '/proposals', icon: FileSpreadsheet, group: 'Sales' },
    { name: 'Orders', href: '/orders', icon: ShoppingCart, group: 'Sales' },
    { name: 'Targets & incentives', href: '/targets', icon: TrendingUp, group: 'Performance' },
    { name: 'Reports', href: '/reports', icon: FileBarChart, group: 'Performance' },
    { name: 'Recycle Bin', href: '/recycle-bin', icon: Trash2, group: 'Manage' },
    { name: 'Settings', href: '/settings', icon: Settings, group: 'Manage', directorOnly: true },
  ].filter((item) => !item.directorOnly || user?.role === 'DIRECTOR');
  const currentPage = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.name || (pathname === '/settings' ? 'My account' : 'Workspace');

  return (
    <div className={`min-h-screen flex flex-col md:flex-row bg-[#06101f]`}>
      {/* Mobile Top Header */}
      <div className="md:hidden bg-navy-900 text-white p-4 flex items-center justify-between shadow-md sticky top-0 z-40">
        <div className="flex items-center space-x-2">
          <img src="/logo-dark.png" alt="Nirmaan Watertech Solutions" width="1200" height="586" className="h-10 w-[82px] object-contain" />
          <span className="font-bold text-base tracking-wide">Sales Tracker</span>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowAddClientModal(true)}
            className="bg-sky-600 text-white p-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1"
          >
            <Plus className="h-4 w-4" />
            <span>Add</span>
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileMenuOpen}
            aria-controls="sidebar-navigation"
            className="p-1 rounded-md text-slate-300 hover:text-white"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && <button type="button" aria-label="Dismiss navigation" onClick={() => setMobileMenuOpen(false)} className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm md:hidden" />}
      <aside id="sidebar-navigation" aria-label="Main navigation" className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-72 shrink-0 flex-col border-r border-white/5 bg-gradient-to-b from-[#0c1930] to-[#081221] text-slate-200 transition-[width,transform] duration-200 md:sticky md:top-0 md:translate-x-0 ${sidebarCollapsed ? 'md:w-20' : 'md:w-64'} ${mobileMenuOpen ? 'visible translate-x-0' : 'invisible -translate-x-full md:visible'}`}>
        <div className={`flex items-center gap-2 border-b border-white/5 p-5 ${sidebarCollapsed ? 'md:flex-col md:px-2 md:py-4' : ''}`}>
          <Link href="/dashboard" title="Sales Tracker home" className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className={`flex h-11 shrink-0 items-center justify-center ${sidebarCollapsed ? 'w-12' : 'w-[72px]'}`}><img src="/logo-dark.png" alt="Nirmaan Watertech Solutions" width="1200" height="586" className="h-auto max-h-full w-full object-contain" /></span>
            <span className={sidebarCollapsed ? 'md:hidden' : ''}><span className="block text-sm font-bold tracking-wide text-white">Sales Tracker</span><span className="mt-0.5 block text-[10px] tracking-wider text-slate-400">{user?.role === 'DIRECTOR' ? 'COMPANY WORKSPACE' : 'SALES WORKSPACE'}</span></span>
          </Link>
          <button type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-sky-400 md:inline-flex">{sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>
          <button type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} className="rounded-lg p-1 text-slate-400 hover:text-white md:hidden"><X className="h-5 w-5" /></button>
        </div>

        {user && <div title={`${user.name} · ${user.role === 'DIRECTOR' ? 'Director' : 'Salesperson'}`} className={`mx-4 my-4 flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.035] p-3 ${sidebarCollapsed ? 'md:mx-2 md:justify-center md:p-2' : ''}`}>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white ${user.role === 'DIRECTOR' ? 'bg-violet-500/80' : 'bg-sky-600'}`}>{user.name.split(' ').filter(Boolean).slice(0, 2).map((word) => word[0]).join('')}</span>
          <div className={`min-w-0 ${sidebarCollapsed ? 'md:hidden' : ''}`}><p className="truncate text-xs font-semibold text-white">{user.name}</p><p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${user.role === 'DIRECTOR' ? 'bg-violet-300' : 'bg-emerald-300'}`} />{user.role === 'DIRECTOR' ? 'Director · All sales data' : 'Salesperson · My sales data'}</p></div>
        </div>}

        <div className={`mb-2 px-4 ${sidebarCollapsed ? 'md:px-2' : ''}`}><button type="button" aria-label="Add Client" title="Add Client" onClick={() => { setShowAddClientModal(true); setMobileMenuOpen(false); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-2.5 text-xs font-semibold text-white shadow-lg shadow-sky-950/20 transition hover:bg-sky-400 focus-visible:outline-sky-300"><Plus className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'md:hidden' : ''}>Add Client</span></button></div>

        <nav aria-label="CRM sections" className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 ${sidebarCollapsed ? 'md:px-2' : ''}`}>
          {['Workspace', 'Sales', 'Performance', 'Manage'].map((group) => <div key={group}>
            <p className={`mb-1.5 px-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 ${sidebarCollapsed ? 'md:hidden' : ''}`}>{group}</p>
            <div className="space-y-1">{navItems.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link key={item.href} href={item.href} title={item.name} aria-label={item.name} aria-current={active ? 'page' : undefined} onClick={() => setMobileMenuOpen(false)} className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-xs transition focus-visible:outline-sky-400 ${sidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${active ? 'border-sky-400/20 bg-gradient-to-r from-sky-500/20 to-sky-500/5 font-semibold text-white shadow-sm' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-sky-300' : 'text-slate-500 group-hover:text-slate-200'}`} /><span className={`flex-1 ${sidebarCollapsed ? 'md:hidden' : ''}`}>{item.name}</span>{active && <ChevronRight className={`h-3.5 w-3.5 text-sky-300 ${sidebarCollapsed ? 'md:hidden' : ''}`} />}
              </Link>;
            })}</div>
          </div>)}
        </nav>

        <div className="space-y-1 border-t border-white/5 p-3">
          {user?.role === 'SALESPERSON' && <Link href="/settings" title="My account" aria-label="My account" onClick={() => setMobileMenuOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-white ${sidebarCollapsed ? 'md:justify-center md:px-2' : ''}`}><Settings className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'md:hidden' : ''}>My account</span></Link>}
          <button type="button" onClick={handleLogout} title="Sign out" aria-label="Sign out" className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-200 focus-visible:outline-rose-300 ${sidebarCollapsed ? 'md:justify-center md:px-2' : ''}`}><LogOut className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'md:hidden' : ''}>Sign out</span></button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar on Desktop */}
        <header className={`hidden md:flex border-b px-6 py-3 items-center justify-between sticky top-0 z-30 bg-[#06101f]/90 border-white/5 backdrop-blur ${dark ? '' : 'crm-night'}`}>
          <div className="flex items-center gap-3"><span className={`text-xs font-semibold text-slate-200`}>{currentPage}</span>{user && <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] bg-white/5 text-slate-400`}><ShieldCheck className="h-3 w-3" />{user.role === 'DIRECTOR' ? 'Company data' : 'My data'}</span>}</div>

          <div className="flex items-center space-x-4">
            {/* Notifications Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label={unreadCount > 0 ? `${unreadCount > 9 ? '9+' : unreadCount} unread notifications` : 'Notifications'}
                aria-expanded={showNotifications}
                className={`relative p-2 rounded-xl transition text-slate-400 hover:text-white hover:bg-white/10`}
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50">
                  <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllNotificationsRead}
                        className="text-[11px] text-sky-600 hover:text-sky-800 font-medium"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-50">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.slice(0, 30).map((n) => (
                        <button
                          type="button"
                          key={n.id}
                          onClick={() => openNotification(n)}
                          className={`block w-full p-3 text-left text-xs transition hover:bg-slate-50 ${n.isRead ? 'bg-white' : 'bg-sky-50/50'}`}
                        >
                          <div className="flex items-start space-x-2">
                            {n.type === 'OVERDUE_ESCALATION' ? (
                              <ShieldAlert className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                            ) : n.type === 'MORNING_SUMMARY' ? (
                              <Sun className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                            ) : n.type === 'ACTIVITY_UPDATE' ? (
                              <Activity className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                            ) : (
                              <Clock className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-800 leading-snug">{n.title}</p>
                              <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">{n.message}</p>
                              <p className="mt-0.5 text-[10px] text-slate-400">{new Date(n.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className={`crm-workspace flex-1 w-full mx-auto ${dark ? 'crm-dark max-w-[1600px] p-4 md:px-7 md:py-5 lg:px-8' : 'crm-night max-w-7xl p-4 md:p-7 lg:p-8'}`}>
          {children}
        </main>
      </div>

      {/* Combined Add Client Modal */}
      {showAddClientModal && (
        <div className={dark ? undefined : 'crm-night'}>
        <AddClientModal
          isOpen={showAddClientModal}
          onClose={() => setShowAddClientModal(false)}
          onSuccess={() => {
            setShowAddClientModal(false);
            window.dispatchEvent(new Event('crm:data-changed'));
          }}
          currentUserRole={user?.role || 'SALESPERSON'}
          currentUserId={user?.id || ''}
        />
        </div>
      )}
    </div>
  );
}
