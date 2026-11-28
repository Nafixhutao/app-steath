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

export const orgDropdownButtonClass = [
  "supabase-org-dropdown-btn [@media(max-width:380px)]:gap-[6px]",
  "[@media(max-width:380px)]:p-[4px] text-[13px] font-medium flex items-center gap-[8px]",
  "py-[4px] px-[8px] rounded-control border border-transparent bg-transparent text-ink-console",
  "cursor-pointer [transition:background-color_150ms,border-color_150ms]",
  "hover:bg-[rgba(255,255,255,0.05)] hover:border-[#2b2933]",
].join(" ");

export const searchButtonClass = [
  "supabase-search-btn [@media(max-width:1023px)]:w-[32px] [@media(max-width:1023px)]:h-[32px]",
  "[@media(max-width:1023px)]:p-0 [@media(max-width:1023px)]:justify-center bg-surface",
  "text-[13px] flex items-center gap-[8px] h-[30px] py-0 px-[10px] rounded-control border",
  "border-[#282631] text-[#8e8c99] cursor-pointer [transition:border-color_150ms,color_150ms]",
  "hover:border-[#383642] hover:text-ink-console",
].join(" ");

export const avatarButtonClass = [
  "supabase-avatar-btn outline-none focus-visible:outline-2 focus-visible:outline-[#818cf8]",
  "focus-visible:outline-offset-[2px] flex items-center justify-center relative border-0",
  "bg-transparent p-0 cursor-pointer rounded-[50%] after:absolute after:top-1/2",
  "after:left-[50%] after:min-w-[44px] after:min-h-[44px]",
].join(" ");

export const dropdownUserHeaderClass = [
  "supabase-dropdown-user-header flex items-center gap-[9px] min-w-0 pt-[6px] pb-[8px] px-[8px]",
  "[&_strong]:block [&_strong]:overflow-hidden [&_strong]:text-ellipsis",
  "[&_strong]:whitespace-nowrap [&_strong]:text-[13px]",
  "[&_strong]:text-[var(--color-ink-console)] [&_small]:block [&_small]:overflow-hidden",
  "[&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_small]:text-[11px]",
  "[&_small]:text-[var(--color-ink-muted)]",
].join(" ");

export const topbarIconButtonClass = [
  "supabase-icon-btn [@media(max-width:1023px)]:hidden cursor-pointer focus-visible:outline-2",
  "focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] flex items-center",
  "justify-center relative w-[32px] h-[32px] rounded-control bg-transparent border-0",
  "[transition:color_150ms,background-color_150ms] after:absolute after:top-1/2",
  "after:left-[50%] after:min-w-[44px] after:min-h-[44px] hover:bg-[rgba(255,255,255,0.05)]",
].join(" ");

export const dropdownItemClass = [
  "supabase-dropdown-item flex items-center gap-[8px] w-full py-[7px] px-[8px] rounded-control",
  "bg-transparent border-0 text-[13px] text-left cursor-pointer no-underline",
  "[transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.06)]",
].join(" ");

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
    <header className="supabase-topbar sticky top-0 z-[60] flex h-[48px] shrink-0 w-full items-center justify-between bg-[var(--color-console)] border-b border-[#23222a] px-[16px] select-none [@media(max-width:1023px)]:h-[52px] [@media(max-width:1023px)]:px-[12px] [@media(max-width:1023px)]:gap-[8px]" aria-label="Global header">
      <div className="supabase-topbar-left [@media(max-width:1023px)]:min-w-0 [@media(max-width:1023px)]:gap-[8px] flex items-center gap-[12px]">
        <button
          type="button"
          className="supabase-mobile-menu-btn hidden [@media(max-width:1023px)]:inline-flex items-center justify-center w-[32px] h-[32px] ml-[-4px] border-0 rounded-control bg-transparent text-ink-console cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
          onClick={() => window.dispatchEvent(new Event("stealth:open-mobile-nav"))}
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <Link
          href="/dashboard/organizations"
          className="flex items-center justify-center p-[4px] rounded-control [transition:opacity_150ms_ease] hover:opacity-[0.85]"
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
        <span className="supabase-topbar-sep font-light [@media(max-width:1023px)]:hidden text-[#44424d] text-[14px]" aria-hidden="true">
          /
        </span>

        {isOrgsPage ? (
          <span className="text-[14px] font-medium text-ink-console">Organizations</span>
        ) : (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              className={orgDropdownButtonClass}
              onClick={() => setOrgDropdownOpen((prev) => !prev)}
              aria-expanded={orgDropdownOpen}
              aria-haspopup="menu"
            >
              <div className="supabase-org-icon-badge bg-[#23212a] flex items-center justify-center w-[20px] h-[20px] rounded-control-sm text-[#a1a0aa]" aria-hidden="true">
                <div className="w-[8px] h-[8px] rounded-[50%] bg-current [box-shadow:-4px_5px_0_0_currentColor,4px_5px_0_0_currentColor]" />
              </div>
              <span className="supabase-org-name [@media(max-width:1023px)]:max-w-[96px] [@media(max-width:380px)]:max-w-[64px] max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">{activeOrg?.name ?? "Select Org"}</span>
              <span className="bg-[rgba(62,207,142,0.1)] text-[10px] font-bold tracking-[0.04em] py-[1px] px-[5px] rounded-control-sm text-accent border border-[rgba(62,207,142,0.25)] leading-[1.2]">FREE</span>
              <ChevronsUpDown className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
            </button>

            {orgDropdownOpen && (
              <div className="supabase-dropdown-menu bg-[#16151a] absolute top-[calc(100%_+_6px)] left-[0] z-[70] min-w-[220px] border border-[#2a2833] rounded-card p-[6px] [box-shadow:0_10px_25px_rgba(0,0,0,0.45)]" role="menu">
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#716f7c] pt-[6px] pb-[4px] px-[8px]">Your Organizations</div>
                <div className="flex flex-col gap-[2px]">
                  {organizations?.map((org) => {
                    const isActive = org.id === activeOrg?.id;
                    return (
                      <button
                        key={org.id}
                        type="button"
                        className={`supabase-dropdown-item flex items-center gap-[8px] w-full py-[7px] px-[8px] rounded-control bg-transparent border-0 text-[13px] text-left cursor-pointer no-underline [transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.06)] ${isActive ? "bg-[rgba(255,255,255,0.08)] font-medium hover:bg-[rgba(255,255,255,0.08)]" : ""}`}
                        onClick={() => void handleSelectOrg(org.id)}
                        role="menuitem"
                      >
                        <div className="supabase-org-icon-badge bg-[#23212a] flex items-center justify-center w-[20px] h-[20px] rounded-control-sm text-[#a1a0aa] small w-[18px] h-[18px] text-[10px]" aria-hidden="true">
                          <span className="text-[10px] font-bold">{getInitials(org.name)}</span>
                        </div>
                        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{org.name}</span>
                        {isActive && (
                          <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="bg-[#23222a] h-[1px] my-[6px] mx-0" />
                <Link
                  href="/dashboard/organizations"
                  className={dropdownItemClass}
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

      <div className="supabase-topbar-right [@media(max-width:1023px)]:gap-[6px] [@media(max-width:1023px)]:shrink-0 flex items-center gap-[12px]">
        <a
          href="https://github.com/Nafixhutao/app-steath/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="supabase-topbar-link [@media(max-width:1023px)]:hidden text-[13px] no-underline [transition:color_150ms] py-[4px] px-[6px]"
        >
          Feedback
        </a>

        <button
          type="button"
          className={searchButtonClass}
          onClick={onOpenSearch}
          aria-label="Search or jump to (Ctrl+K)"
        >
          <Search className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
          <span className="supabase-search-label [@media(max-width:1023px)]:hidden text-[12px]">Search...</span>
          <kbd className="supabase-search-kbd [@media(max-width:1023px)]:hidden bg-[#23212a] text-[10px] [font-family:inherit] py-[1px] px-[5px] rounded-control-sm text-[#716f7c] border border-[#302e3a]">Ctrl K</kbd>
        </button>

        <a
          href="https://docs.nazxf.my.id"
          target="_blank"
          rel="noopener noreferrer"
          className={topbarIconButtonClass}
          title="Help & Documentation"
          aria-label="Help & Documentation"
        >
          <HelpCircle className="w-4 h-4" aria-hidden="true" />
        </a>

        <button
          type="button"
          className={topbarIconButtonClass}
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
            className={avatarButtonClass}
            onClick={() => setUserDropdownOpen((prev) => !prev)}
            aria-expanded={userDropdownOpen}
            aria-haspopup="menu"
            aria-label="User account menu"
          >
            <UserAvatar user={user} size={26} className="w-[26px] h-[26px] rounded-[50%] object-cover border border-[#3a3845]" decorative />
          </button>

          {userDropdownOpen && (
            <div className="supabase-dropdown-menu bg-[#16151a] absolute top-[calc(100%_+_6px)] left-auto right-0 z-[70] min-w-[220px] border border-[#2a2833] rounded-card p-[6px] [box-shadow:0_10px_25px_rgba(0,0,0,0.45)] right-aligned" role="menu">
              <div className={dropdownUserHeaderClass}>
                <UserAvatar user={user} size={36} />
                <div className="flex flex-col gap-[1px] min-w-0">
                  <strong title={userName}>{userName}</strong>
                  <small title={user?.email ?? undefined}>
                    {user?.email ?? "No email on file"}
                  </small>
                  {user?.username ? (
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#716f7c]">@{user.username}</span>
                  ) : null}
                </div>
              </div>
              <div className="bg-[#23222a] h-[1px] my-[6px] mx-0" />
              <Link
                href="/dashboard/settings"
                className={dropdownItemClass}
                role="menuitem"
                onClick={() => setUserDropdownOpen(false)}
              >
                <Settings className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                <span>Organization settings</span>
              </Link>
              <button
                type="button"
                role="menuitem"
                className="supabase-dropdown-item flex items-center gap-[8px] w-full py-[7px] px-[8px] rounded-control bg-transparent border-0 text-[13px] text-left cursor-pointer no-underline [transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.06)] text-rose-400"
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
