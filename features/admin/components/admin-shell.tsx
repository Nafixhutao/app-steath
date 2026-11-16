"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopBar } from "./admin-topbar";

/** The rail choice is a device preference, so it survives reloads. */
const COLLAPSE_STORAGE_KEY = "stealth.admin.sidebar.collapsed:v1";

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignored: the rail still works, it just forgets the preference.
  }
}

/**
 * Shared chrome for every /admin route: the admin navigation rail, the top bar
 * (rail toggle and page title), and the content area. Deliberately
 * separate from ApplicationShell so customer pages keep the customer sidebar
 * and admin pages never mount it.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Read the stored preference after mount so the server and the first client
  // render agree on the expanded width.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- verbatim from stealth-forge
  useEffect(() => setCollapsed(readCollapsedPreference()), []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      writeCollapsedPreference(next);
      return next;
    });
  }, []);

  return (
    <div data-admin className="flex min-h-dvh bg-[var(--projects-bg)]">
      <AdminSidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        collapsed={collapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopBar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onOpenMobile={openSidebar}
        />
        <main className="relative min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
