"use client";

import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { activeAdminNavItem } from "./admin-nav";

/**
 * Admin top bar: the rail toggle and the current page title. The rail control
 * lives here rather than in the sidebar so it stays reachable while the rail
 * is collapsed. Sign out stays in the rail so no account menu is needed here.
 */
export function AdminTopBar({
  collapsed,
  onToggleCollapsed,
  onOpenMobile,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
}) {
  const pathname = usePathname();

  const item = activeAdminNavItem(pathname);
  const Icon = item?.icon;

  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[#322F37] bg-[#121014]/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-[#121014]/80 sm:gap-3 sm:px-4">
      {/* Desktop rail control. */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-expanded={!collapsed}
        className="hidden size-8 shrink-0 items-center justify-center rounded-md text-[#AAA6AE] transition-colors hover:bg-white/[0.05] hover:text-[#EEEAF0] lg:inline-flex"
      >
        {collapsed ? (
          <PanelLeftOpen size={16} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <PanelLeftClose size={16} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>

      {/* Mobile sheet opener. */}
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[#AAA6AE] transition-colors hover:bg-white/[0.05] hover:text-[#EEEAF0] lg:hidden"
      >
        <svg viewBox="0 0 24 24" className="size-[17px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <line x1="3" x2="21" y1="6" y2="6" />
          <line x1="3" x2="21" y1="12" y2="12" />
          <line x1="3" x2="21" y1="18" y2="18" />
        </svg>
      </button>

      {/* Current page. */}
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon ? (
          <span
            aria-hidden="true"
            className="hidden size-7 shrink-0 items-center justify-center rounded-md border border-[#322F37] bg-[#1B191D] text-[#AAA6AE] sm:flex"
          >
            <Icon size={14} strokeWidth={1.8} />
          </span>
        ) : null}
        <h1 className="m-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-[#EEEAF0]">
          {item?.label ?? "Admin"}
        </h1>
      </div>
    </header>
  );
}
