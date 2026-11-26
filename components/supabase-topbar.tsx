"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  HelpCircle,
  Menu,
  Search,
  ChevronsUpDown,
  Check,
  Building,
  LogOut,
  Settings,
} from "lucide-react";
import {
  authClient,
  signOut,
  useActiveOrganization,
  useListOrganizations,
  useSession,
} from "@/lib/auth-client";
import { getInitials } from "@/components/identity";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/components/toast-context";

export function SupabaseTopbar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const { data: organizations } = useListOrganizations();

  const isOrgsPage = pathname === "/dashboard/organizations";
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOrgDropdownOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOrgDropdownOpen(false);
        setUserDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  async function handleSelectOrg(orgId: string) {
    setOrgDropdownOpen(false);
    const result = await authClient.organization.setActive({ organizationId: orgId });
    if (result.error) {
      toast.error("Could not switch Organization", result.error.message ?? "Try again.");
      return;
    }
    router.push("/dashboard/projects");
  }

  const user = session?.user;
  const userName = user?.name || user?.email || "User";

  return (
    <header className="supabase-topbar" aria-label="Global header">
      <div className="supabase-topbar-left">
        <button
          type="button"
          className="supabase-mobile-menu-btn"
          onClick={() => window.dispatchEvent(new Event("stealth:open-mobile-nav"))}
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <Link
          href="/dashboard/organizations"
          className="supabase-logo-link"
          title="Stealth Home"
          aria-label="Stealth Home"
        >
          <Image
            src="/stealth-cat.png"
            alt="Stealth"
            width={22}
            height={22}
            priority
            className="w-[22px] h-[22px] object-contain"
          />
        </Link>
        <span className="supabase-topbar-sep" aria-hidden="true">
          /
        </span>

        {isOrgsPage ? (
          <span className="text-[14px] font-medium text-ink-console">Organizations</span>
        ) : (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              className="supabase-org-dropdown-btn"
              onClick={() => setOrgDropdownOpen((prev) => !prev)}
              aria-expanded={orgDropdownOpen}
              aria-haspopup="menu"
            >
              <div className="supabase-org-icon-badge" aria-hidden="true">
                <div className="supabase-org-dots" />
              </div>
              <span className="supabase-org-name">{activeOrg?.name ?? "Select Org"}</span>
              <span className="supabase-free-pill">FREE</span>
              <ChevronsUpDown className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
            </button>

            {orgDropdownOpen && (
              <div className="supabase-dropdown-menu" role="menu">
                <div className="supabase-dropdown-header">Your Organizations</div>
                <div className="flex flex-col gap-[2px]">
                  {organizations?.map((org) => {
                    const isActive = org.id === activeOrg?.id;
                    return (
                      <button
                        key={org.id}
                        type="button"
                        className={`supabase-dropdown-item ${isActive ? "is-active" : ""}`}
                        onClick={() => void handleSelectOrg(org.id)}
                        role="menuitem"
                      >
                        <div className="supabase-org-icon-badge small" aria-hidden="true">
                          <span className="text-[10px] font-bold">{getInitials(org.name)}</span>
                        </div>
                        <span className="supabase-dropdown-item-name">{org.name}</span>
                        {isActive && (
                          <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="supabase-dropdown-divider" />
                <Link
                  href="/dashboard/organizations"
                  className="supabase-dropdown-item"
                  onClick={() => setOrgDropdownOpen(false)}
                >
                  <Building className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                  <span>All organizations</span>
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="supabase-topbar-right">
        <a
          href="https://github.com/Nafixhutao/app-steath/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="supabase-topbar-link"
        >
          Feedback
        </a>

        <button
          type="button"
          className="supabase-search-btn"
          onClick={onOpenSearch}
          aria-label="Search or jump to (Ctrl+K)"
        >
          <Search className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
          <span className="supabase-search-label">Search...</span>
          <kbd className="supabase-search-kbd">Ctrl K</kbd>
        </button>

        <a
          href="https://docs.nazxf.my.id"
          target="_blank"
          rel="noopener noreferrer"
          className="supabase-icon-btn"
          title="Help & Documentation"
          aria-label="Help & Documentation"
        >
          <HelpCircle className="w-4 h-4" aria-hidden="true" />
        </a>

        <button
          type="button"
          className="supabase-icon-btn"
          title="Notifications"
          aria-label="Notifications"
          onClick={() => {
            toast.info(
              "Notifications",
              "All services operating normally. No unread notifications.",
            );
          }}
        >
          <Bell className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            className="supabase-avatar-btn"
            onClick={() => setUserDropdownOpen((prev) => !prev)}
            aria-expanded={userDropdownOpen}
            aria-haspopup="menu"
            aria-label="User account menu"
          >
            <UserAvatar user={user} size={26} className="supabase-avatar-img" decorative />
          </button>

          {userDropdownOpen && (
            <div className="supabase-dropdown-menu right-aligned" role="menu">
              <div className="supabase-dropdown-user-header">
                <UserAvatar user={user} size={36} />
                <div className="supabase-dropdown-user-meta">
                  <strong title={userName}>{userName}</strong>
                  <small title={user?.email ?? undefined}>
                    {user?.email ?? "No email on file"}
                  </small>
                  {user?.username ? (
                    <span className="supabase-user-handle">@{user.username}</span>
                  ) : null}
                </div>
              </div>
              <div className="supabase-dropdown-divider" />
              <Link
                href="/dashboard/settings"
                className="supabase-dropdown-item"
                role="menuitem"
                onClick={() => setUserDropdownOpen(false)}
              >
                <Settings className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                <span>Organization settings</span>
              </Link>
              <button
                type="button"
                role="menuitem"
                className="supabase-dropdown-item text-rose-400"
                onClick={async () => {
                  setUserDropdownOpen(false);
                  await signOut();
                  router.replace("/login");
                }}
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span>Log out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
