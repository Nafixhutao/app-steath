"use client";

import { usePathname } from "next/navigation";
import type { RefObject } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { PanelToggleIcon } from "./panel-toggle-icon";
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
  onToggleRef,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
  onToggleRef?: RefObject<HTMLButtonElement | null>;
}) {
  const pathname = usePathname();

  const item = activeAdminNavItem(pathname);
  const Icon = item?.icon;

  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[#322F37] bg-[#121014]/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-[#121014]/80 sm:gap-3 sm:px-4">
      {/* Desktop rail control. */}
      <button
        ref={onToggleRef}
        type="button"
        onClick={onToggleCollapsed}
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-expanded={!collapsed}
        className="hidden size-8 shrink-0 items-center justify-center rounded-md text-[#AAA6AE] transition-colors hover:bg-white/[0.05] hover:text-[#EEEAF0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)] lg:inline-flex"
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
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[#AAA6AE] transition-colors hover:bg-white/[0.05] hover:text-[#EEEAF0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)] lg:hidden"
      >
        <PanelToggleIcon className="size-[17px]" />
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
