"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Boxes,
  Database,
  Container,
  Archive,
  Globe,
  Gauge,
  Users,
  Settings,
  Building,
  Plus,
  ArrowRight,
  X,
} from "lucide-react";
import { useActiveOrganization } from "@/lib/auth-client";
import { listProjects, type ProjectSummary } from "@/lib/projects-client";
import { useResource } from "@/lib/resource";

interface CommandItem {
  id: string;
  title: string;
  category: "Navigation" | "Projects" | "Actions";
  icon: React.ReactNode;
  subtitle?: string;
  onSelect: () => void;
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data: activeOrg } = useActiveOrganization();

  const projects = useResource(() => listProjects(), [activeOrg?.id], {
    enabled: Boolean(activeOrg?.id),
  });
  const projectList: ProjectSummary[] = useMemo(() => projects.data ?? [], [projects.data]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setQuery("");
    setSelectedIndex(0);
    onClose();
  }, [onClose]);

  // Build commands list
  const allCommands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      // Navigation
      {
        id: "nav-projects",
        title: "Projects",
        category: "Navigation",
        subtitle: "View all projects in current organization",
        icon: <Boxes className="w-4 h-4 text-emerald-400" />,
        onSelect: () => {
          router.push("/dashboard/projects");
          onClose();
        },
      },
      {
        id: "nav-orgs",
        title: "Organizations",
        category: "Navigation",
        subtitle: "Switch or manage your organizations",
        icon: <Building className="w-4 h-4 text-zinc-400" />,
        onSelect: () => {
          router.push("/dashboard/organizations");
          onClose();
        },
      },
      {
        id: "nav-databases",
        title: "Databases",
        category: "Navigation",
        subtitle: "Manage dedicated PostgreSQL instances",
        icon: <Database className="w-4 h-4 text-blue-400" />,
        onSelect: () => {
          router.push("/dashboard/databases");
          onClose();
        },
      },
      {
        id: "nav-services",
        title: "Services",
        category: "Navigation",
        subtitle: "View web services and background workers",
        icon: <Container className="w-4 h-4 text-purple-400" />,
        onSelect: () => {
          router.push("/dashboard/services");
          onClose();
        },
      },
      {
        id: "nav-backups",
        title: "Backups",
        category: "Navigation",
        subtitle: "Database snapshots and disaster recovery",
        icon: <Archive className="w-4 h-4 text-amber-400" />,
        onSelect: () => {
          router.push("/dashboard/backups");
          onClose();
        },
      },
      {
        id: "nav-domains",
        title: "Domains",
        category: "Navigation",
        subtitle: "Custom domains and SSL certificates",
        icon: <Globe className="w-4 h-4 text-teal-400" />,
        onSelect: () => {
          router.push("/dashboard/domains");
          onClose();
        },
      },
      {
        id: "nav-usage",
        title: "Usage & Billing",
        category: "Navigation",
        subtitle: "Resource consumption and quotas",
        icon: <Gauge className="w-4 h-4 text-cyan-400" />,
        onSelect: () => {
          router.push("/dashboard/usage");
          onClose();
        },
      },
      {
        id: "nav-members",
        title: "Team Members",
        category: "Navigation",
        subtitle: "Manage organization collaborators and roles",
        icon: <Users className="w-4 h-4 text-indigo-400" />,
        onSelect: () => {
          router.push("/dashboard/members");
          onClose();
        },
      },
      {
        id: "nav-settings",
        title: "Organization Settings",
        category: "Navigation",
        subtitle: "Name, slug, and general configuration",
        icon: <Settings className="w-4 h-4 text-zinc-400" />,
        onSelect: () => {
          router.push("/dashboard/settings");
          onClose();
        },
      },
      // Actions
      {
        id: "action-new-project",
        title: "Create new project",
        category: "Actions",
        subtitle: "Launch a complete backend built on Postgres",
        icon: <Plus className="w-4 h-4 text-emerald-400" />,
        onSelect: () => {
          router.push("/dashboard/projects");
          onClose();
        },
      },
      {
        id: "action-new-org",
        title: "Create new organization",
        category: "Actions",
        subtitle: "Set up a new isolated workspace",
        icon: <Plus className="w-4 h-4 text-emerald-400" />,
        onSelect: () => {
          router.push("/dashboard/organizations");
          onClose();
        },
      },
    ];

    // Add Projects from current organization
    for (const p of projectList) {
      list.push({
        id: `project-${p.id}`,
        title: p.name,
        category: "Projects",
        subtitle: `${p.slug} · ${p.serviceCount} services, ${p.databaseCount} DB`,
        icon: <Boxes className="w-4 h-4 text-emerald-400" />,
        onSelect: () => {
          router.push(`/dashboard/projects/${p.id}`);
          onClose();
        },
      });
    }

    return list;
  }, [onClose, projectList, router]);

  // Filter commands by search query
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.subtitle && c.subtitle.toLowerCase().includes(q)) ||
        c.category.toLowerCase().includes(q),
    );
  }, [allCommands, query]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev - 1 < 0 ? Math.max(0, filteredCommands.length - 1) : prev - 1,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          selected.onSelect();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredCommands, handleClose, open, selectedIndex]);

  if (!open) return null;

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="command-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="command-palette-search-row">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search projects, databases, services, or navigate..."
            className="command-palette-input"
            autoComplete="off"
            spellCheck="false"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelectedIndex(0);
              }}
              className="command-palette-clear-btn"
              aria-label="Clear search query"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
          <kbd className="command-palette-kbd">ESC</kbd>
        </div>

        <div className="command-palette-list-wrap" role="listbox">
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty">
              <p className="text-zinc-400 text-sm">No results found for &ldquo;{query}&rdquo;</p>
              <p className="text-zinc-500 text-xs mt-1">
                Try searching for Projects, Databases, Services, or Team settings.
              </p>
            </div>
          ) : (
            filteredCommands.map((command, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={command.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`command-palette-item ${isSelected ? "is-selected" : ""}`}
                  onClick={command.onSelect}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="command-palette-item-icon">{command.icon}</div>
                  <div className="command-palette-item-text">
                    <span className="command-palette-item-title">{command.title}</span>
                    {command.subtitle && (
                      <span className="command-palette-item-sub">{command.subtitle}</span>
                    )}
                  </div>
                  <span className="command-palette-item-cat">{command.category}</span>
                  {isSelected && (
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-400 ml-2" aria-hidden="true" />
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="command-palette-footer">
          <span className="command-palette-footer-item">
            <kbd className="command-palette-mini-kbd">&uarr;&darr;</kbd> Navigate
          </span>
          <span className="command-palette-footer-item">
            <kbd className="command-palette-mini-kbd">&crarr;</kbd> Select
          </span>
          <span className="command-palette-footer-item">
            <kbd className="command-palette-mini-kbd">ESC</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
