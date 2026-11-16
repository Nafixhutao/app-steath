import {
  Activity,
  Gauge,
  Server,
  Shield,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Exact match instead of prefix (Overview must not swallow /admin/*). */
  exact?: boolean;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

/** Admin navigation — shared by the rail and the top bar title. */
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Admin",
    items: [{ label: "Overview", href: "/admin", icon: Gauge, exact: true }],
  },
  {
    label: "Observability",
    items: [
      { label: "Infrastructure", href: "/admin/infrastructure", icon: Server },
      { label: "Host metrics", href: "/admin/host-metrics", icon: Activity },
      { label: "Scan findings", href: "/admin/findings", icon: Shield },
      {
        label: "Abuse reports",
        href: "/admin/abuse-reports",
        icon: TriangleAlert,
      },
    ],
  },
  {
    label: "Platform",
    items: [{ label: "Users", href: "/admin/users", icon: Users }],
  },
];

export function isAdminNavActive(pathname: string, item: AdminNavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/** Longest matching item wins, so /admin/users/{id} still reports Users. */
export function activeAdminNavItem(pathname: string): AdminNavItem | undefined {
  let match: AdminNavItem | undefined;
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (!isAdminNavActive(pathname, item)) continue;
      if (!match || item.href.length > match.href.length) match = item;
    }
  }
  return match;
}
