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
import {
  Archive,
  Bell,
  ChartPie,
  ChevronDown,
  ChevronsUpDown,
  Code,
  ExternalLink,
  Gauge,
  GitPullRequestArrow,
  Gift,
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

type Theme = "light" | "dark" | "system";

const primaryItems: Array<{ label: string; icon: IconName; href: string }> = [
  { label: "Overview", icon: "chart", href: "/dashboard" },
  { label: "Usage", icon: "gauge", href: "/dashboard/usage" },
  { label: "Projects", icon: "projects", href: "/dashboard/projects" },
  { label: "Services", icon: "services", href: "/dashboard/services" },
  { label: "Databases", icon: "databases", href: "/dashboard/databases" },
  { label: "Backups", icon: "backups", href: "/dashboard/backups" },
  { label: "Domains", icon: "domains", href: "/dashboard/domains" },
];

const secondaryItems: Array<{ label: string; icon: IconName; href: string }> = [
  { label: "Members", icon: "face", href: "/dashboard/members" },
  { label: "Organization settings", icon: "settings", href: "/dashboard/settings" },
];

/** The Platform Admin link, shown only when `/api/admin/status` says so. */
const adminItems: Array<{ label: string; icon: IconName; href: string }> = [
  { label: "Scan findings", icon: "admin", href: "/dashboard/admin/findings" },
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
  projects: ChartPie,
  services: Zap,
  databases: ShieldCheck,
  domains: ExternalLink,
  gauge: Gauge,
  backups: Archive,
  admin: ShieldCheck,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  if (name === "slack") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6.2 14.5a2.2 2.2 0 1 1-2.2-2.2h2.2v2.2ZM7.3 14.5a2.2 2.2 0 1 1 4.4 0V20a2.2 2.2 0 1 1-4.4 0v-5.5Z" />
        <path d="M9.5 6.2a2.2 2.2 0 1 1 2.2-2.2v2.2H9.5ZM9.5 7.3a2.2 2.2 0 1 1 0 4.4H4a2.2 2.2 0 1 1 0-4.4h5.5Z" />
        <path d="M17.8 9.5A2.2 2.2 0 1 1 20 11.7h-2.2V9.5ZM16.7 9.5a2.2 2.2 0 1 1-4.4 0V4a2.2 2.2 0 1 1 4.4 0v5.5Z" />
        <path d="M14.5 17.8a2.2 2.2 0 1 1-2.2 2.2v-2.2h2.2ZM14.5 16.7a2.2 2.2 0 1 1 0-4.4H20a2.2 2.2 0 1 1 0 4.4h-5.5Z" />
      </svg>
    );
  }

  const IconComponent = iconMap[name];
  return <IconComponent size={size} strokeWidth={1.7} aria-hidden="true" />;
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
      <span className="identity-initial" aria-hidden="true">
        {getInitials(organization.name)}
      </span>
      {!collapsed ? (
        <>
          <span className="identity-name" title={organization.name}>
            {organization.name}
          </span>
          <span className="plan-chip">{organization.plan}</span>
          <ChevronDown size={16} strokeWidth={1.7} aria-hidden="true" />
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
      className="mobile-sidebar-sheet"
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
      className={`sidebar-row ${active ? "is-active" : ""} ${collapsed ? "is-collapsed" : ""} ${mobile ? "is-mobile" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
    >
      <Icon name={icon} />
      {!collapsed ? <span className="sidebar-row-label">{label}</span> : null}
      {!collapsed && accent ? (
        <Gift size={16} strokeWidth={1.7} className="agent-gift" aria-hidden="true" />
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
    <div className="search-overlay" role="presentation">
      <button
        type="button"
        className="search-backdrop"
        onClick={onClose}
        aria-label="Close search"
      />
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-dialog-input">
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
        <div className="search-results">
          <p className="search-section-label">Navigation</p>
          {results.length ? (
            results.map((item) => (
              <button
                key={item}
                type="button"
                className="search-result"
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
            <p className="search-empty">No results found.</p>
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
  const [theme, setTheme] = useState<Theme>("dark");
  const [organizationSwitcherOpen, setOrganizationSwitcherOpen] = useState(false);
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [organizationError, setOrganizationError] = useState("");
  const [organizationBusy, setOrganizationBusy] = useState(false);

  const activeOrganizationId = session?.session.activeOrganizationId;
  const activeOrganization = organizations?.find((item) => item.id === activeOrganizationId);
  const sidebarOrganization: OrganizationIdentity = activeOrganization
    ? {
        name: activeOrganization.name,
        plan: organization.plan,
        description: organization.description,
      }
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
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
    <div className={`sidebar-panel ${mobile ? "mobile-sidebar-panel" : ""}`}>
      <header className={`sidebar-header ${collapsed && !mobile ? "is-collapsed" : ""}`}>
        {!collapsed || mobile ? (
          <button
            type="button"
            className="org-switcher"
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
            className="sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
          >
            <Icon name="x" />
          </button>
        ) : (
          <button
            type="button"
            className="sidebar-toggle"
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
            className="organization-switcher-menu"
            role="dialog"
            aria-label="Organization switcher"
          >
            <p className="search-section-label">Your Organizations</p>
            {organizations?.map((item) => (
              <button
                key={item.id}
                type="button"
                className="organization-switcher-option"
                aria-pressed={item.id === activeOrganizationId}
                onClick={() => void switchOrganization(item.id)}
                disabled={organizationBusy}
              >
                <span className="identity-initial" aria-hidden="true">
                  {getInitials(item.name)}
                </span>
                <span className="organization-switcher-name">{item.name}</span>
                {item.id === activeOrganizationId ? <small>Active</small> : null}
              </button>
            ))}
            {organizationError ? (
              <p className="organization-switcher-error" role="alert">
                {organizationError}
              </p>
            ) : null}
            {createOrganizationOpen ? (
              <form className="organization-switcher-create" onSubmit={createOrganization}>
                <label htmlFor={mobile ? "mobile-new-organization" : "new-organization"}>
                  Organization name
                </label>
                <input
                  id={mobile ? "mobile-new-organization" : "new-organization"}
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  maxLength={80}
                  required
                />
                <div>
                  <button
                    type="button"
                    onClick={() => setCreateOrganizationOpen(false)}
                    disabled={organizationBusy}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={organizationBusy}>
                    {organizationBusy ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="organization-switcher-add"
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
        className={`sidebar-search ${collapsed && !mobile ? "is-collapsed" : ""}`}
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

      <nav className="sidebar-nav" aria-label="Sidebar links">
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

      <div className="sidebar-bottom">
        <div className="sidebar-divider" />
        <nav aria-label="Organization links">
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
        <div className="sidebar-divider" />
        <div className={`profile-area ${collapsed && !mobile ? "is-collapsed" : ""}`}>
          {profileOpen && !mobile ? (
            <div
              className={`profile-menu ${collapsed ? "is-collapsed" : ""}`}
              role="menu"
              aria-label="Account menu"
            >
              <div className="profile-menu-user">
                <span className="profile-avatar large" aria-hidden="true">
                  {getInitials(user.name)}
                </span>
                <div>
                  <strong title={user.name}>{user.name}</strong>
                  <small>{user.role}</small>
                </div>
              </div>
              <div className="sidebar-divider" />
              <div className="theme-row">
                <span>Theme</span>
                <div className="theme-toggle" role="group" aria-label="Theme">
                  {(["light", "dark", "system"] as Theme[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={theme === value ? "is-selected" : ""}
                      onClick={() => setTheme(value)}
                      aria-label={`${value} mode`}
                      aria-pressed={theme === value}
                    >
                      <Icon
                        name={value === "light" ? "sun" : value === "dark" ? "moon" : "monitor"}
                        size={14}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div className="sidebar-divider" />
              <button type="button" className="profile-menu-row">
                <Icon name="user" size={15} />
                Profile Settings
              </button>
              <button type="button" className="profile-menu-row">
                <Icon name="external" size={15} />
                Refer and Earn
              </button>
              <button
                type="button"
                className="profile-menu-row logout-row"
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
          <div className="profile-controls">
            <button
              type="button"
              className="profile-button"
              onClick={() => setProfileOpen((value) => !value)}
              aria-label={profileOpen ? "Close account menu" : "Open account menu"}
              title={collapsed && !mobile ? "Account menu" : undefined}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              <span className="profile-avatar" aria-hidden="true">
                {getInitials(user.name)}
              </span>
              {!collapsed || mobile ? (
                <>
                  <span className="profile-copy">
                    <strong title={user.name}>{user.name}</strong>
                    <small>{user.role}</small>
                  </span>
                  <Icon name="chevrons" size={16} />
                </>
              ) : null}
            </button>
            {!collapsed || mobile ? (
              <button
                type="button"
                className="notification-button"
                aria-label="Notifications"
                onClick={() => setProfileOpen(false)}
              >
                <Icon name="bell" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="user-mobile-topbar">
        <Link href="/dashboard" className="mobile-brand" aria-label="Stealth home">
          <Image src="/stealth-cat.png" alt="" width={24} height={24} priority />
        </Link>
        <div className="mobile-topbar-actions">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            title="Search"
          >
            <Icon name="search" />
          </button>
          <button
            type="button"
            onClick={() => setMobileAccountOpen((value) => !value)}
            aria-label="Account menu"
            aria-expanded={mobileAccountOpen}
          >
            <span className="mobile-account-avatar" aria-hidden="true">
              {getInitials(user.name)}
            </span>
          </button>
          <button
            type="button"
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
          <div className="mobile-account-menu" role="menu">
            <strong title={user.name}>{user.name}</strong>
            <small>{user.role}</small>
            <div className="sidebar-divider" />
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
        className={`sidebar desktop-sidebar bg-[#121014] ${collapsed ? "is-collapsed" : ""}`}
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
            className="mobile-sidebar-overlay"
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
