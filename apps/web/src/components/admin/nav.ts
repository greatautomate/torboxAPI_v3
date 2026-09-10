import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  Database,
  Download,
  FileClock,
  FlaskConical,
  Gauge,
  KeyRound,
  Radio,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}
export interface NavGroup {
  title?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    items: [
      { to: '/admin', label: 'Overview', icon: Gauge, end: true },
      { to: '/admin/alerts', label: 'Alerts', icon: Bell },
    ],
  },
  {
    title: 'Access',
    items: [
      { to: '/admin/upstreams', label: 'Upstream accounts', icon: Boxes },
      { to: '/admin/clients', label: 'Clients', icon: Users },
      { to: '/admin/keys', label: 'API keys', icon: KeyRound },
      { to: '/admin/policies', label: 'Policies', icon: ShieldCheck },
    ],
  },
  {
    title: 'Traffic',
    items: [
      { to: '/admin/logs', label: 'Request logs', icon: ScrollText },
      { to: '/admin/activity', label: 'Activity', icon: Activity },
      { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/admin/downloads', label: 'Downloads', icon: Download },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { to: '/admin/webhooks', label: 'Webhooks', icon: Webhook },
      { to: '/admin/events', label: 'Events', icon: Radio },
      { to: '/admin/cache', label: 'Cache', icon: Database },
      { to: '/admin/playground', label: 'Playground', icon: FlaskConical },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin/settings', label: 'Settings', icon: Settings },
      { to: '/admin/admins', label: 'Admins', icon: Shield },
      { to: '/admin/audit', label: 'Audit log', icon: FileClock },
      { to: '/admin/system', label: 'System', icon: Server },
    ],
  },
];

export function titleFor(pathname: string): string {
  const all = NAV.flatMap((g) => g.items);
  const exact = all.find((i) => i.to === pathname);
  if (exact) return exact.label;
  const prefix = all.filter((i) => i.to !== '/admin' && pathname.startsWith(i.to + '/')).sort((a, b) => b.to.length - a.to.length)[0];
  return prefix?.label ?? 'Admin';
}
