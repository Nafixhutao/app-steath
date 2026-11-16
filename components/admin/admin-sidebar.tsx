"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LogOut, X } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import {
  LABEL_ENTER_TRANSITION,
  LABEL_EXIT_TRANSITION,
  PANEL_CLOSE_TRANSITION,
  PANEL_TRANSITION,
  SIDEBAR_COLLAPSE_TRANSITION,
  SIDEBAR_EXPAND_TRANSITION,
  SPRING_LAYOUT,
  SPRING_PRESS,
} from "@/lib/ease";

import { cn } from "@/lib/utils";
import { ADMIN_NAV, isAdminNavActive, type AdminNavItem } from "./admin-nav";

/** Rail geometry. Collapsed matches the reference rail; expanded matches the
    previous fixed admin panel width. */
export const ADMIN_RAIL_COLLAPSED_WIDTH = 72;
export const ADMIN_RAIL_EXPANDED_WIDTH = 228;

/** The project mark, shown in a bordered tile like the reference rail. */
function AdminBrandMark({
  collapsed,
  className,
}: {
  collapsed: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border border-[#322F37] bg-[#1B191D]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--projects-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden={collapsed ? undefined : "true"}>
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </svg>
    </span>
  );
}

function AdminNavRow({
  item,
  active,
  collapsed,
  layoutId,
  reduce,
  onNavigate,
}: {
  item: AdminNavItem;
  active: boolean;
  collapsed: boolean;
  layoutId: string;
  reduce: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <motion.div layout="position" transition={SPRING_LAYOUT}>
      <motion.button
        type="button"
        onClick={onNavigate}
        whileTap={reduce ? undefined : { scale: 0.98 }}
        transition={SPRING_PRESS}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          "relative isolate flex h-9 w-full items-center rounded-md text-left text-[13px] transition-colors",
          collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
          active
            ? "text-[var(--projects-accent)]"
            : "text-[#C5C1C9] hover:bg-white/[0.035] hover:text-[#EEEAF0]",
        )}
      >
        {active && (
          <motion.span
            aria-hidden="true"
            layoutId={layoutId}
            transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
            className="absolute inset-0 -z-10 rounded-md bg-[color-mix(in_srgb,var(--projects-accent)_10%,transparent)]"
          />
        )}
        <Icon
          size={16}
          strokeWidth={1.8}
          className={cn(
            "shrink-0",
            active ? "text-[var(--projects-accent)]" : "text-[#AAA6AE]",
          )}
        />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: LABEL_ENTER_TRANSITION }}
              exit={{ opacity: 0, transition: LABEL_EXIT_TRANSITION }}
              className="truncate"
            >
              {item.label}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
}

function AdminSidebarBody({
  collapsed = false,
  onNavigate,
  onMobileClose,
}: {
  collapsed?: boolean;
  /** Fires after a navigation link is chosen (mobile closes the sheet). */
  onNavigate?: (href: string) => void;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const layoutId = useId();
  const reduce = useReducedMotion() ?? false;

  const handleNavigate = (href: string) => {
    router.push(href);
    onNavigate?.(href);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/");
  };

  return (
    <>
      <header
        className={cn(
          "flex h-[56px] shrink-0 items-center",
          collapsed ? "justify-center" : "gap-2.5 px-4",
        )}
      >
        <AdminBrandMark collapsed={collapsed} className="size-8" />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="brand"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: LABEL_ENTER_TRANSITION }}
              exit={{ opacity: 0, transition: LABEL_EXIT_TRANSITION }}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-[#EEEAF0]">
                Admin Console
              </span>
              <span className="admin-mono shrink-0 rounded-[5px] border border-[#322F37] px-[5px] py-[2px] text-[9.5px] font-medium leading-none text-[#AAA6AE]">
                PROD
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={onMobileClose}
          aria-label="Close sidebar"
          className="inline-flex size-6 shrink-0 items-center justify-center text-[#AAA6AE] transition-colors hover:text-[#EEEAF0] lg:hidden"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </header>

      <nav
        aria-label="Admin navigation"
        className={cn(
          "admin-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {ADMIN_NAV.map((group, groupIndex) => (
          <div key={group.label}>
            {groupIndex > 0 && (
              <div
                aria-hidden="true"
                className={cn(
                  "my-2 h-px bg-[#26242b]",
                  collapsed ? "mx-2" : "mx-1",
                )}
              />
            )}
            {!collapsed && (
              <p className="m-0 px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6d6a74]">
                {group.label}
              </p>
            )}
            {group.items.map((item) => (
              <AdminNavRow
                key={item.href}
                item={item}
                active={isAdminNavActive(pathname, item)}
                collapsed={collapsed}
                layoutId={layoutId}
                reduce={reduce}
                onNavigate={() => handleNavigate(item.href)}
              />
            ))}
          </div>
        ))}
      </nav>

      <footer
        className={cn(
          "mt-auto shrink-0 border-t border-[#26242b] py-2.5",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <Link
          href="/dashboard"
          onClick={() => onNavigate?.("/dashboard")}
          title={collapsed ? "Back to console" : undefined}
          className={cn(
            "group flex items-center rounded-md text-left text-[12px] text-[#AAA6AE] transition-colors hover:bg-white/[0.035] hover:text-[#EEEAF0]",
            collapsed ? "h-9 justify-center" : "h-9 gap-2.5 px-2.5",
          )}
        >
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <span className="relative size-2 rounded-full bg-[var(--projects-ring)]" />
          </span>
          {!collapsed && <span className="truncate">Back to console</span>}
        </Link>
        <motion.button
          type="button"
          onClick={() => void handleSignOut()}
          whileTap={reduce ? undefined : { scale: 0.98 }}
          transition={SPRING_PRESS}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "mt-1 flex w-full items-center rounded-md text-left text-[12px] text-[#AAA6AE] transition-colors hover:bg-white/[0.035] hover:text-[#EEEAF0]",
            collapsed ? "h-9 justify-center" : "h-9 gap-2.5 px-2.5",
          )}
        >
          <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
          {!collapsed && <span className="truncate">Sign out</span>}
        </motion.button>
      </footer>
    </>
  );
}

/** Desktop rail (fixed panel) + mobile slide-in sheet. The collapse state and
    its toggle live in AdminShell so the top bar can own the control. */
export function AdminSidebar({
  open,
  onClose,
  collapsed,
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Mobile sheet effect: scroll lock, focus handoff, Escape, focus trap.
  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      left: body.style.left,
      overflow: body.style.overflow,
      position: body.style.position,
      right: body.style.right,
      top: body.style.top,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";

    const frame = requestAnimationFrame(() => {
      const selector = "a[href], button:not([disabled])";
      const first = panelRef.current?.querySelector<HTMLElement>(selector);
      (first ?? panelRef.current)?.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(frame);
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  const FOCUSABLE = "a[href], button:not([disabled])";

  return (
    <>
      {/* Desktop rail — admin area owns its own chrome, the customer rail
          never mounts on /admin routes. Width is animated so the content
          column reflows with the rail instead of snapping. */}
      <motion.aside
        aria-label="Admin navigation"
        initial={false}
        animate={{
          width: collapsed
            ? ADMIN_RAIL_COLLAPSED_WIDTH
            : ADMIN_RAIL_EXPANDED_WIDTH,
        }}
        transition={
          collapsed ? SIDEBAR_COLLAPSE_TRANSITION : SIDEBAR_EXPAND_TRANSITION
        }
        className="hidden shrink-0 flex-col overflow-hidden border-r border-[#322F37] bg-[#121014] lg:flex"
      >
        <AdminSidebarBody collapsed={collapsed} />
      </motion.aside>

      {mounted && (
        <div
          className={cn(
            "pointer-events-none fixed inset-0 z-[70] lg:hidden",
            open ? "visible" : "invisible",
          )}
        >
          <motion.div
            initial={false}
            animate={{ opacity: open ? 1 : 0 }}
            transition={open ? PANEL_TRANSITION : PANEL_CLOSE_TRANSITION}
            onClick={onClose}
            aria-hidden="true"
            className={cn(
              "absolute inset-0 bg-black/50",
              open ? "pointer-events-auto" : "pointer-events-none",
            )}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            aria-hidden={!open}
            tabIndex={-1}
            initial={false}
            animate={{
              opacity: reduce ? (open ? 1 : 0) : 1,
              x: reduce ? 0 : open ? "0%" : "-108%",
            }}
            transition={open ? PANEL_TRANSITION : PANEL_CLOSE_TRANSITION}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key !== "Tab") return;
              const focusable = panelRef.current
                ? Array.from(
                    panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
                  )
                : [];
              if (focusable.length === 0) {
                event.preventDefault();
                panelRef.current?.focus();
                return;
              }
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
            className={cn(
              "pointer-events-auto absolute bottom-0 left-0 top-0 flex w-[84vw] max-w-[320px] flex-col overflow-hidden border-r border-[#302E34] bg-[#121014] shadow-[12px_0_32px_rgba(0,0,0,0.45)]",
              !open && "pointer-events-none",
            )}
          >
            <AdminSidebarBody
              onNavigate={() => onClose()}
              onMobileClose={onClose}
            />
          </motion.div>
        </div>
      )}
    </>
  );
}
