"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getAdminStatus } from "@/lib/admin-client";
import { authClient, signOut, useListOrganizations, useSession } from "@/lib/auth-client";
import {
  defaultOrganization,
  defaultUser,
  getInitials,
  type OrganizationIdentity,
  type UserIdentity,
} from "./identity";
import { UserAvatar } from "./user-avatar";

// lucide-react: one consistent 1.7pt-stroke icon language across the console;
// each glyph maps to a real destination (Inbox -> Inbox, ChartPie -> Overview).
import {
  Archive,
  Bell,
  Boxes,
  ChartPie,
  ChevronDown,
  ChevronsUpDown,
  Code,
  Container,
  Database,
  ExternalLink,
  Gauge,
  GitPullRequestArrow,
  Gift,
  Globe,
  Inbox,
  LogOut,
  Monitor,
  Moon,
  ScanFace,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  User,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

type IconName =
  | "inbox"
  | "review"
  | "code"
  | "shield"
  | "chart"
  | "zap"
  | "slack"
  | "face"
  | "settings"
  | "search"
  | "chevrons"
  | "user"
  | "logout"
  | "bell"
  | "external"
  | "sun"
  | "moon"
  | "monitor"
  | "x"
  | "projects"
  | "services"
  | "databases"
  | "domains"
  | "gauge"
  | "backups"
  | "admin";

const primaryItems: Array<{ label: string; icon: IconName; href: string }> = [
  { label: "Projects", icon: "projects", href: "/dashboard/projects" },
  { label: "Team", icon: "user", href: "/dashboard/members" },
  { label: "Services", icon: "services", href: "/dashboard/services" },
  { label: "Databases", icon: "databases", href: "/dashboard/databases" },
  { label: "Backups", icon: "backups", href: "/dashboard/backups" },
  { label: "Domains", icon: "domains", href: "/dashboard/domains" },
  { label: "Usage", icon: "gauge", href: "/dashboard/usage" },
];

const secondaryItems: Array<{ label: string; icon: IconName; href: string }> = [
  { label: "Organization settings", icon: "settings", href: "/dashboard/settings" },
];

/** The Platform Admin link, shown only when `/api/admin/status` says so. */
const adminItems: Array<{ label: string; icon: IconName; href: string }> = [
  { label: "Admin console", icon: "admin", href: "/admin" },
];

const searchItems = ["Go to Projects", "Go to Services", "Go to Databases", "Log out"];

const sidebarMorphTransition: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 35,
  mass: 0.75,
};

const toggleIconTransition: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.55,
};

const drawerTransition: Transition = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1],
};

const overlayTransition: Transition = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1],
};

const iconMap: Record<Exclude<IconName, "slack">, LucideIcon> = {
  inbox: Inbox,
  review: GitPullRequestArrow,
  code: Code,
  shield: ShieldCheck,
  chart: ChartPie,
  zap: Zap,
  face: ScanFace,
  settings: Settings,
  search: Search,
  chevrons: ChevronsUpDown,
  user: User,
  logout: LogOut,
  bell: Bell,
  external: ExternalLink,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  x: X,
  projects: Boxes,
  services: Container,
  databases: Database,
  domains: Globe,
  gauge: Gauge,
  backups: Archive,
  admin: ShieldCheck,
};

function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  if (name === "slack") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <path d="M6.2 14.5a2.2 2.2 0 1 1-2.2-2.2h2.2v2.2ZM7.3 14.5a2.2 2.2 0 1 1 4.4 0V20a2.2 2.2 0 1 1-4.4 0v-5.5Z" />
        <path d="M9.5 6.2a2.2 2.2 0 1 1 2.2-2.2v2.2H9.5ZM9.5 7.3a2.2 2.2 0 1 1 0 4.4H4a2.2 2.2 0 1 1 0-4.4h5.5Z" />
        <path d="M17.8 9.5A2.2 2.2 0 1 1 20 11.7h-2.2V9.5ZM16.7 9.5a2.2 2.2 0 1 1-4.4 0V4a2.2 2.2 0 1 1 4.4 0v5.5Z" />
        <path d="M14.5 17.8a2.2 2.2 0 1 1-2.2 2.2v-2.2h2.2ZM14.5 16.7a2.2 2.2 0 1 1 0-4.4H20a2.2 2.2 0 1 1 0 4.4h-5.5Z" />
      </svg>
    );
  }

  const IconComponent = iconMap[name];
  return <IconComponent size={size} strokeWidth={1.7} className={className} aria-hidden="true" />;
}

function PanelToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <motion.rect
        y="5.2"
        width="3.2"
        height="5.6"
        rx="0.9"
        fill="currentColor"
        animate={{ x: collapsed ? 4.2 : 8.6 }}
        transition={toggleIconTransition}
      />
    </svg>
  );
}

function Identity({
  collapsed = false,
  organization,
}: {
  collapsed?: boolean;
  organization: OrganizationIdentity;
}) {
  return (
    <>
      <span className="inline-flex h-[20px] flex-none bg-[#2b2930] text-[#eeedf0] text-[10px] font-semibold w-[20px] items-center justify-center rounded-control" aria-hidden="true">
        {getInitials(organization.name)}
      </span>
      {!collapsed ? (
        <>
          <span className="min-w-0 overflow-hidden flex-initial text-ellipsis whitespace-nowrap text-[14px] font-semibold max-w-[min(18ch,100%)] tracking-[-0.01em]" title={organization.name}>
            {organization.name}
          </span>
          <ChevronDown size={16} strokeWidth={1.7} className="flex-none text-[#7e7a84]" aria-hidden="true" />
        </>
      ) : null}
    </>
  );
}

function MobileSidebarSheet({
  reduceMotion,
  children,
}: {
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  const isPresent = useIsPresent();

  return (
    <motion.aside
      className="mobile-sidebar-sheet hidden [@media(max-width:1023px)]:block [@media(max-width:1023px)]:inset-[auto_0_0] [@media(max-width:1023px)]:fixed [@media(max-width:1023px)]:z-[60] [@media(max-width:1023px)]:w-[min(100%,560px)] [@media(max-width:1023px)]:h-[min(82dvh,720px)] [@media(max-width:1023px)]:my-0 [@media(max-width:1023px)]:mx-auto [@media(max-width:1023px)]:overflow-hidden [@media(max-width:1023px)]:border [@media(max-width:1023px)]:border-[#302e34] [@media(max-width:1023px)]:border-b-0 [@media(max-width:1023px)]:rounded-[20px_20px_0_0] [@media(max-width:1023px)]:bg-[#232127] [@media(max-width:1023px)]:[box-shadow:0_-4px_14px_rgb(0_0_0_/_42%)]"
      role="dialog"
      aria-modal="true"
      aria-label="Main navigation"
      aria-hidden={!isPresent}
      style={{ pointerEvents: isPresent ? "auto" : "none" }}
      initial={{ y: "100%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0 }}
      transition={reduceMotion ? { duration: 0 } : drawerTransition}
    >
      {children}
    </motion.aside>
  );
}

function NavRow({
  label,
  icon,
  href,
  active,
  collapsed,
  accent,
  onClick,
  mobile = false,
}: {
  label: string;
  icon: IconName;
  href: string;
  active: boolean;
  collapsed: boolean;
  accent?: boolean;
  onClick: () => void;
  mobile?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`sidebar-row [@media(hover:hover)_and_(pointer:fine)]:hover:text-ink-console relative isolate flex h-[36px] flex-none items-center gap-[10px] hover:bg-[rgb(255_255_255_/_6%)] focus-visible:bg-[rgb(255_255_255_/_6%)] [&>svg]:relative [&>svg]:z-[1] [&>svg]:flex-none [transition:width_360ms_cubic-bezier(0.22,1,0.36,1),margin_360ms_cubic-bezier(0.22,1,0.36,1),padding_360ms_cubic-bezier(0.22,1,0.36,1)] border-0 rounded-control text-[#9e9aa7] cursor-pointer text-[13.5px] font-medium leading-[20px] text-left hover:text-ink-console focus-visible:text-ink-console focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] ${active ? "bg-[#161418] text-ink-console" : ""} ${collapsed ? "w-[40px] mx-auto justify-center p-0" : "w-[calc(100%_-_24px)] my-[1px] mx-[12px] py-0 px-[8px] [@media(max-width:1023px)]:h-[40px] [@media(max-width:1023px)]:my-0"}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
    >
      <Icon name={icon} />
      {!collapsed ? <span className="relative z-[1] min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span> : null}
      {!collapsed && accent ? (
        <Gift size={16} strokeWidth={1.7} className="ml-auto text-[#ffa057] text-[16px] leading-[16px]" aria-hidden="true" />
      ) : null}
    </Link>
  );
}

function SearchDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (label: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const results = searchItems.filter((item) =>
    item.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div className="flex items-start justify-center pt-[20vh] pb-0 px-[16px] fixed inset-0 z-[100] bg-[rgb(0_0_0_/_45%)] [backdrop-filter:blur(3px)]" role="presentation">
      <button
        type="button"
        className="focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] absolute inset-0 border-0 bg-transparent"
        onClick={onClose}
        aria-label="Close search"
      />
      <div className="search-dialog relative z-[1] w-[min(520px,100%)] overflow-hidden border border-[#3a373f] rounded-card bg-[#232127] [box-shadow:0_24px_80px_rgb(0_0_0_/_60%)]" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-dialog-input flex h-[48px] items-center gap-[12px] py-0 px-[14px] border-b border-b-[#322f37] text-[#8a8791]">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && onClose()}
            placeholder="Search…"
            aria-label="Search commands"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="h-[304px] overflow-y-auto p-[6px]">
          <p className="search-section-label m-0 p-[8px] text-[#96929d] text-[12px]">Navigation</p>
          {results.length ? (
            results.map((item) => (
              <button
                key={item}
                type="button"
                className="focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] bg-transparent hover:bg-[#2b2930] flex w-full h-[32px] items-center gap-[12px] py-0 px-[10px] border-0 rounded-[5px] text-ink-bright cursor-pointer text-[14px]! text-left"
                onClick={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <Icon
                  name={
                    item === "Go to Agent"
                      ? "code"
                      : item === "Status page"
                        ? "shield"
                        : item === "Log out"
                          ? "logout"
                          : "inbox"
                  }
                  size={15}
                />
                <span>{item}</span>
              </button>
            ))
          ) : (
            <p className="py-[32px] px-[10px] text-[#8a8791] text-[13px] text-center">No results found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  organization = defaultOrganization,
  user = defaultUser,
}: {
  organization?: OrganizationIdentity;
  user?: UserIdentity;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { data: organizations, isPending: organizationsPending } = useListOrganizations();
  const reduceMotion = useReducedMotion() ?? false;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [organizationSwitcherOpen, setOrganizationSwitcherOpen] = useState(false);
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [organizationError, setOrganizationError] = useState("");
  const [organizationBusy, setOrganizationBusy] = useState(false);

  useEffect(() => {
    // The Supabase topbar owns the global header now, so its mobile menu
    // button asks the sidebar to open the navigation sheet.
    function openMobileNav() {
      setMobileOpen(true);
    }
    window.addEventListener("stealth:open-mobile-nav", openMobileNav);
    return () => window.removeEventListener("stealth:open-mobile-nav", openMobileNav);
  }, []);

  const activeOrganizationId = session?.session.activeOrganizationId;
  const activeOrganization = organizations?.find((item) => item.id === activeOrganizationId);
  const sidebarOrganization: OrganizationIdentity = activeOrganization
    ? { name: activeOrganization.name }
    : organization;

  const closeOrganizationSwitcher = () => {
    setOrganizationSwitcherOpen(false);
    setCreateOrganizationOpen(false);
    setOrganizationError("");
  };

  const switchOrganization = async (organizationId: string) => {
    setOrganizationBusy(true);
    setOrganizationError("");
    const result = await authClient.organization.setActive({ organizationId });
    setOrganizationBusy(false);
    if (result.error) {
      setOrganizationError(result.error.message ?? "Could not switch Organization.");
      return;
    }
    setOrganizationSwitcherOpen(false);
    setCreateOrganizationOpen(false);
    setOrganizationError("");
    router.refresh();
  };

  const createOrganization = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = organizationName.trim();
    const slug = name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!name || !slug) {
      setOrganizationError("Enter an Organization name using letters or numbers.");
      return;
    }

    setOrganizationBusy(true);
    setOrganizationError("");
    const result = await authClient.organization.create({
      name,
      slug: `${slug}-${crypto.randomUUID().slice(0, 8)}`,
    });
    setOrganizationBusy(false);
    if (result.error) {
      setOrganizationError(result.error.message ?? "Could not create Organization.");
      return;
    }
    setOrganizationName("");
    setOrganizationSwitcherOpen(false);
    setCreateOrganizationOpen(false);
    setOrganizationError("");
    router.refresh();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+K belongs to the dashboard shell's CommandPalette. Handling it
      // here as well opened two stacked aria-modal dialogs.
      if (event.key === "Escape") {
        setMobileOpen(false);
        setProfileOpen(false);
        setMobileAccountOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!mobileOpen && !searchOpen) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousOverscroll = root.style.overscrollBehavior;
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    return () => {
      root.style.overflow = previousOverflow;
      root.style.overscrollBehavior = previousOverscroll;
    };
  }, [mobileOpen, searchOpen]);

  // Platform Admin is defined by an environment email list, so the only way to
  // know is to ask the Control Plane. A failure just hides the link.
  useEffect(() => {
    let cancelled = false;

    getAdminStatus()
      .then((status) => {
        if (!cancelled) setIsPlatformAdmin(status.platformAdmin);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [session]);

  const choose = (label: string) => {
    setMobileOpen(false);
    closeOrganizationSwitcher();
    if (label === "Organization settings") setProfileOpen(false);
  };

  const renderContent = (mobile = false) => (
    <div className={`sidebar-panel flex w-full min-w-0 h-full flex-col overflow-hidden border-r border-r-[#282631] bg-console [@media(max-width:1023px)]:bg-[#232127] [@media(max-width:1023px)]:rounded-t-[20px] ${mobile ? "mobile-sidebar-panel" : ""}`}>
      <header className={`sidebar-header relative flex h-[48px] shrink-0 items-center [transition:gap_360ms_cubic-bezier(0.22,1,0.36,1),padding_360ms_cubic-bezier(0.22,1,0.36,1)] ${collapsed && !mobile ? "justify-center gap-0 p-0" : "gap-[8px] py-0 px-[16px]"}`}>
        {!collapsed || mobile ? (
          <button
            type="button"
            className="org-switcher focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] flex min-w-0 flex-1 items-center gap-[8px] p-0 border-0 rounded-control bg-transparent text-[#eeedf0] cursor-pointer text-left"
            onClick={() => {
              setOrganizationSwitcherOpen((value) => !value);
              setCreateOrganizationOpen(false);
              setOrganizationError("");
            }}
            aria-label="Switch organization"
            aria-expanded={organizationSwitcherOpen}
            aria-haspopup="dialog"
            disabled={organizationsPending || organizationBusy}
          >
            <Identity organization={sidebarOrganization} />
          </button>
        ) : null}
        {mobile ? (
          <button
            type="button"
            className="focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] bg-transparent hover:bg-[rgb(255_255_255_/_5%)] inline-flex w-[32px] h-[32px] flex-none items-center justify-center p-0 border-0 rounded-control text-[#b5b2b9] cursor-pointer hover:text-ink-console"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
          >
            <Icon name="x" />
          </button>
        ) : (
          <button
            type="button"
            className="sidebar-toggle [transition:width_360ms_cubic-bezier(0.22,1,0.36,1),margin_360ms_cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] inline-flex w-[32px] h-[32px] flex-none items-center justify-center p-0 border-0 rounded-control bg-transparent text-[#b5b2b9] cursor-pointer hover:bg-[rgb(255_255_255_/_5%)] hover:text-ink-console"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => {
              setCollapsed((value) => !value);
            }}
          >
            <PanelToggleIcon collapsed={collapsed} />
          </button>
        )}
        {organizationSwitcherOpen && (!collapsed || mobile) ? (
          <div
            className="organization-switcher-menu overflow-y-auto absolute top-[44px] left-[12px] z-[90] w-[min(280px,calc(100vw_-_32px))] max-h-[min(70dvh,480px)] p-[8px] border border-[#39363f] rounded-control bg-[#201d23] [box-shadow:0_16px_36px_rgb(0_0_0_/_40%)]"
            role="dialog"
            aria-label="Organization switcher"
          >
            <p className="search-section-label m-[4px_8px_8px] p-[8px] text-[#96929d] text-[12px]">Your Organizations</p>
            {organizations?.map((item) => (
              <button
                key={item.id}
                type="button"
                className="organization-switcher-option flex w-full min-h-[36px] items-center gap-[8px] py-[4px] px-[8px] border-0 rounded-control-sm bg-transparent text-[#eeedf0] cursor-pointer text-left hover:bg-[rgb(255_255_255_/_6%)]"
                aria-pressed={item.id === activeOrganizationId}
                onClick={() => void switchOrganization(item.id)}
                disabled={organizationBusy}
              >
                <span className="inline-flex h-[20px] flex-none bg-[#2b2930] text-[#eeedf0] text-[10px] font-semibold w-[20px] items-center justify-center rounded-control" aria-hidden="true">
                  {getInitials(item.name)}
                </span>
                <span className="min-w-0 flex-1 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap">{item.name}</span>
                {item.id === activeOrganizationId ? (
                  <small className="text-[#aaa4af] text-[11px]">Active</small>
                ) : null}
              </button>
            ))}
            {organizationError ? (
              <p className="m-[8px] text-[#f39c9c] text-[12px] leading-[1.4]" role="alert">
                {organizationError}
              </p>
            ) : null}
            {createOrganizationOpen ? (
              <form className="organization-switcher-create grid gap-[7px] pt-[12px] pb-[4px] px-[8px] border-t border-t-[#39363f]" onSubmit={createOrganization}>
                <label htmlFor={mobile ? "mobile-new-organization" : "new-organization"}>
                  Organization name
                </label>
                <input
                  className="w-full h-[34px] px-[8px] border border-[#49444e] rounded-control-sm bg-[#171519] text-[#eeedf0]"
                  id={mobile ? "mobile-new-organization" : "new-organization"}
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  maxLength={80}
                  required
                />
                <div className="flex justify-end gap-[6px]">
                  <button
                    type="button"
                    className="min-h-[30px] px-[9px] border border-[#49444e] rounded-control-sm bg-transparent text-[#eeedf0] cursor-pointer"
                    onClick={() => setCreateOrganizationOpen(false)}
                    disabled={organizationBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="min-h-[30px] px-[9px] border border-[#d8c783] rounded-control-sm bg-[#d8c783] text-[#201d16] cursor-pointer"
                    disabled={organizationBusy}
                  >
                    {organizationBusy ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="bg-transparent hover:bg-[rgb(255_255_255_/_6%)] flex w-full min-h-[36px] items-center gap-[8px] py-[4px] px-[8px] border-0 rounded-[0] text-[#d8c783] cursor-pointer text-left mt-[6px] border-t border-t-[#39363f] text-[13px]!"
                onClick={() => {
                  setOrganizationError("");
                  setCreateOrganizationOpen(true);
                }}
              >
                <span aria-hidden="true">+</span> Create Organization
              </button>
            )}
          </div>
        ) : null}
      </header>
      <button
        type="button"
        className={`sidebar-search flex h-[32px] items-center gap-[8px] border-0 rounded-control text-[#eeedf0] cursor-pointer text-left [@media(max-width:1023px)]:h-[40px] [transition:width_360ms_cubic-bezier(0.22,1,0.36,1),margin_360ms_cubic-bezier(0.22,1,0.36,1),padding_360ms_cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] [&>svg]:flex-none [&>svg]:text-[#b5b2b9] [&>span]:min-w-0 [&>span]:flex-1 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>span]:text-[14px] [&>span]:font-medium [&>span]:leading-[20px] [&>kbd]:flex-none [&>kbd]:text-[#b5b2b9] [&>kbd]:[font-family:inherit] [&>kbd]:text-[12px] [&>kbd]:leading-[15px] ${collapsed && !mobile ? "w-[32px] mx-auto mt-[6px] justify-center p-0 bg-transparent" : "w-[calc(100%_-_16px)] mt-[6px] mb-0 mx-[8px] py-0 pr-[14px] pl-[8px] bg-[#171519] hover:bg-[#1c1a1f]"}`}
        onClick={() => setSearchOpen(true)}
        aria-label="Search Ctrl K"
      >
        <Icon name="search" />
        {!collapsed || mobile ? (
          <>
            <span>Search</span>
            <kbd>Ctrl K</kbd>
          </>
        ) : null}
      </button>

      <nav className="sidebar-nav flex min-h-[0] flex-1 flex-col gap-[2px] mt-[8px] pt-0 pb-[8px] px-0 overflow-x-hidden overflow-y-auto" aria-label="Sidebar links">
        {primaryItems.map((item) => (
          <NavRow
            key={item.label}
            {...item}
            collapsed={collapsed && !mobile}
            mobile={mobile}
            active={
              item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href)
            }
            onClick={() => choose(item.label)}
          />
        ))}
      </nav>

      <div className="sidebar-bottom shrink-0 mt-[auto] pb-[12px] bg-console">
        <div className="h-[1px] my-0 mx-[8px] bg-[#322f37]" />
        <nav className="flex flex-col gap-[2px] py-[8px]" aria-label="Organization links">
          {secondaryItems.map((item) => (
            <NavRow
              key={item.label}
              {...item}
              collapsed={collapsed && !mobile}
              mobile={mobile}
              active={pathname.startsWith(item.href)}
              onClick={() => choose(item.label)}
            />
          ))}
          {isPlatformAdmin
            ? adminItems.map((item) => (
                <NavRow
                  key={item.label}
                  {...item}
                  collapsed={collapsed && !mobile}
                  mobile={mobile}
                  active={pathname.startsWith(item.href)}
                  onClick={() => choose(item.label)}
                />
              ))
            : null}
        </nav>
        {mobile ? (
          <>
            <div className="h-[1px] my-0 mx-[8px] bg-[#322f37]" />
            <div className={`profile-area relative pt-[10px] pb-[6px] px-[12px] [@media(max-width:1023px)]:pb-[calc(13px_+_env(safe-area-inset-bottom))] [transition:padding_360ms_cubic-bezier(0.22,1,0.36,1)] ${collapsed && !mobile ? "is-collapsed" : ""}`}>
              {profileOpen && !mobile ? (
                <div
                  className={`profile-menu absolute right-[12px] bottom-[calc(100%_+_5px)] left-[12px] z-[60] p-[6px] border border-[#2d2d35] rounded-card-lg bg-[#232127] [box-shadow:0_16px_40px_rgb(0_0_0_/_50%)] ${collapsed ? "is-collapsed" : ""}`}
                  role="menu"
                  aria-label="User menu"
                >
                  <div className="profile-menu-user flex items-center gap-[10px] p-[10px]">
                    <UserAvatar user={user} size={36} className="profile-avatar-image w-[40px] h-[40px] flex-none rounded-[50%] object-cover large" />
                    <div>
                      <strong title={user.name}>{user.name}</strong>
                      <small>{user.role}</small>
                    </div>
                  </div>
                  <div className="h-[1px] my-0 mx-[8px] bg-[#322f37]" />

                  <button
                    type="button"
                    className="profile-menu-row text-[13px] focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] flex w-full h-[32px] items-center gap-[10px] py-0 px-[10px] border-0 rounded-control bg-transparent text-[#b3b0ba] cursor-pointer text-left hover:bg-[#26262e] hover:text-ink-console logout-row"
                    onClick={async () => {
                      await signOut();
                      router.replace("/");
                    }}
                  >
                    <Icon name="logout" size={15} />
                    Log out
                  </button>
                </div>
              ) : null}
              <div className="profile-controls flex items-center gap-[6px]">
                <button
                  type="button"
                  className="profile-button focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px] hover:bg-[rgb(255_255_255_/_5%)] hover:text-ink-console flex min-w-0 flex-1 items-center gap-[8px] py-[4px] px-[6px] [transition:flex-basis_360ms_cubic-bezier(0.22,1,0.36,1),background-color_150ms_ease] border-0 rounded-card bg-transparent text-ink-console cursor-pointer text-left hover:bg-[rgba(255,255,255,0.05)]"
                  onClick={() => setProfileOpen((value) => !value)}
                  aria-label={profileOpen ? "Close user menu" : "Open user menu"}
                  title={collapsed && !mobile ? "User menu" : undefined}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                >
                  <UserAvatar user={user} size={32} className="profile-avatar inline-flex w-[32px] h-[32px] flex-none items-center justify-center rounded-[50%] bg-[#2b2930] text-ink-console text-[13px] font-semibold" decorative />
                  {!collapsed || mobile ? (
                    <>
                      <span className="profile-copy min-w-0 flex-1 flex flex-col gap-[2px] [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[14px] [&>strong]:font-medium [&>strong]:leading-[17px] [&>small]:text-[#7e7a84] [&>small]:text-[12px] [&>small]:leading-[15px]">
                        <strong title={user.name}>{user.name}</strong>
                        <small>{user.role}</small>
                      </span>
                      <Icon name="chevrons" size={16} className="flex-none text-[#7e7a84]" />
                    </>
                  ) : null}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <div className="user-mobile-topbar hidden [@media(max-width:1023px)]:inset-[0_0_auto] [@media(max-width:1023px)]:fixed [@media(max-width:1023px)]:z-[40] [@media(max-width:1023px)]:flex [@media(max-width:1023px)]:h-[59px] [@media(max-width:1023px)]:items-center [@media(max-width:1023px)]:justify-between [@media(max-width:1023px)]:py-0 [@media(max-width:1023px)]:px-[16px] [@media(max-width:1023px)]:border-b [@media(max-width:1023px)]:border-b-[#2b2b2e] [@media(max-width:1023px)]:bg-[#1a181d]">
        <Link href="/dashboard" className="mobile-brand [@media(max-width:1023px)]:inline-flex [@media(max-width:1023px)]:w-[44px] [@media(max-width:1023px)]:h-[44px] [@media(max-width:1023px)]:items-center [@media(max-width:1023px)]:justify-center [@media(max-width:1023px)]:rounded-card focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-[2px]" aria-label="Stealth home">
          <Image src="/stealth-cat.png" alt="" width={24} height={24} className="h-[24px] w-[24px] object-contain" priority />
        </Link>
        <div className="mobile-topbar-actions [@media(max-width:1023px)]:[&>button]:inline-flex [@media(max-width:1023px)]:[&>button]:h-[44px] [@media(max-width:1023px)]:[&>button]:w-[44px] [@media(max-width:1023px)]:[&>button]:items-center [@media(max-width:1023px)]:[&>button]:justify-center [@media(max-width:1023px)]:[&>button]:p-0 [@media(max-width:1023px)]:[&>button]:border-0 [@media(max-width:1023px)]:[&>button]:rounded-card [@media(max-width:1023px)]:[&>button]:bg-transparent [@media(max-width:1023px)]:[&>button]:text-ink-bright [@media(max-width:1023px)]:[&>button]:cursor-pointer [@media(max-width:1023px)]:[&>button:hover]:bg-[#1b1b1e] [@media(max-width:1023px)]:flex [@media(max-width:1023px)]:items-center [@media(max-width:1023px)]:gap-[6px]">
          <button
            type="button"
            className="focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-2"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            title="Search"
          >
            <Icon name="search" />
          </button>
          <button
            type="button"
            className="focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-2"
            onClick={() => setMobileAccountOpen((value) => !value)}
            aria-label="User menu"
            aria-expanded={mobileAccountOpen}
          >
            <UserAvatar user={user} size={26} className="mobile-account-avatar [@media(max-width:1023px)]:inline-flex [@media(max-width:1023px)]:w-[26px] [@media(max-width:1023px)]:h-[26px] [@media(max-width:1023px)]:items-center [@media(max-width:1023px)]:justify-center [@media(max-width:1023px)]:border [@media(max-width:1023px)]:border-[#3d3945] [@media(max-width:1023px)]:rounded-[50%] [@media(max-width:1023px)]:bg-[#2b2930] [@media(max-width:1023px)]:text-ink-console [@media(max-width:1023px)]:text-[11px] [@media(max-width:1023px)]:font-semibold" decorative />
          </button>
          <button
            type="button"
            className="focus-visible:outline-2 focus-visible:outline-[#aaa6ec] focus-visible:outline-offset-2"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-haspopup="dialog"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        {mobileAccountOpen ? (
          <div className="mobile-account-menu absolute top-[48px] right-[12px] z-[45] flex w-[min(248px,calc(100vw_-_24px))] min-w-0 flex-col gap-[3px] p-[10px] border border-[#303033] rounded-card bg-[#232127] [box-shadow:0_16px_40px_rgb(0_0_0_/_40%)]" role="menu">
            <strong title={user.name}>{user.name}</strong>
            <small>{user.role}</small>
            <div className="h-[1px] my-0 mx-[8px] bg-[#322f37]" />
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.replace("/");
              }}
            >
              Log out
            </button>
          </div>
        ) : null}
      </div>
      <motion.aside
        className={`sidebar relative z-50 w-[264px] min-w-0 flex-none h-full flex flex-col bg-[#121014] desktop-sidebar [@media(max-width:1023px)]:hidden ${collapsed ? "overflow-hidden" : ""}`}
        aria-label="Main navigation"
        initial={false}
        animate={{
          width: collapsed ? 52 : 264,
        }}
        transition={reduceMotion ? { duration: 0 } : sidebarMorphTransition}
      >
        {renderContent()}
      </motion.aside>
      <AnimatePresence initial={false}>
        {mobileOpen ? (
          <motion.button
            type="button"
            className="mobile-sidebar-overlay hidden [@media(max-width:1023px)]:block [@media(max-width:1023px)]:fixed [@media(max-width:1023px)]:inset-0 [@media(max-width:1023px)]:z-[50] [@media(max-width:1023px)]:border-0 [@media(max-width:1023px)]:bg-[rgb(0_0_0_/_50%)]"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : overlayTransition}
          />
        ) : null}
        {mobileOpen ? (
          <MobileSidebarSheet reduceMotion={reduceMotion}>{renderContent(true)}</MobileSidebarSheet>
        ) : null}
      </AnimatePresence>
      <SearchDialog
        key={searchOpen ? "open" : "closed"}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(label) => {
          if (label === "Go to Projects") router.push("/dashboard/projects");
          if (label === "Go to Services") router.push("/dashboard/services");
          if (label === "Go to Databases") router.push("/dashboard/databases");
          if (label === "Log out") {
            void signOut().then(() => router.replace("/"));
          }
        }}
      />
    </>
  );
}
