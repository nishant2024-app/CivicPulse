"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Building,
  Check,
  ChevronsUpDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ScrollText,
  Settings,
  SquarePen,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Me, Permission } from "@civicpulse/shared";
import { Logo } from "@/components/logo";
import { api, errorMessage } from "@/lib/api";
import { activeMembership, can, useLogout, useSwitchOrganization } from "@/lib/auth";
import { cn, humanize, initials } from "@/lib/utils";

interface NavItem {
  href: string;
  label: (me: Me) => string;
  icon: LucideIcon;
  permission?: Permission;
  needsOrganization?: boolean;
  badge?: "unread";
}

const NAV: Array<{ heading: string | null; items: NavItem[] }> = [
  {
    heading: null,
    items: [
      { href: "/dashboard", label: () => "Overview", icon: LayoutDashboard },
      {
        href: "/complaints",
        label: (me) =>
          me.role === "CITIZEN" ? "My reports" : me.role === "FIELD_WORKER" ? "My work" : "Reports",
        icon: ClipboardList,
        needsOrganization: true,
      },
      {
        href: "/report",
        label: () => "Report an issue",
        icon: SquarePen,
        permission: "complaint:create",
      },
      {
        href: "/notifications",
        label: () => "Notifications",
        icon: Bell,
        needsOrganization: true,
        badge: "unread",
      },
    ],
  },
  {
    heading: "Organization",
    items: [
      {
        href: "/departments",
        label: () => "Departments",
        icon: Building,
        permission: "department:manage",
      },
      { href: "/members", label: () => "People", icon: Users, permission: "member:manage" },
      { href: "/audit", label: () => "Audit log", icon: ScrollText, permission: "audit:read" },
    ],
  },
  { heading: "Account", items: [{ href: "/settings", label: () => "Settings", icon: Settings }] },
];

export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => api.get<{ count: number }>("/notifications/unread-count"),
    select: (data) => data.count,
    enabled,
    refetchInterval: 30_000,
  });
}

function NavLinks({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  const unread = useUnreadCount(!!me.activeOrganizationId && !!me.role);
  return (
    <nav aria-label="Main" className="space-y-5">
      {NAV.map((group) => {
        const items = group.items.filter(
          (item) =>
            (!item.permission || can(me, item.permission)) &&
            (!item.needsOrganization || (me.activeOrganizationId && me.role)),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.heading ?? "main"}>
            {group.heading ? (
              <p className="label-mono mb-1.5 px-3 text-white/40">{group.heading}</p>
            ) : null}
            <ul>
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 border-l-[3px] px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "border-signal bg-white/8 text-white"
                          : "border-transparent text-white/65 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <item.icon className="size-4" aria-hidden />
                      <span className="flex-1">{item.label(me)}</span>
                      {item.badge === "unread" && unread.data ? (
                        <span className="bg-signal px-1.5 font-mono text-[11px] font-medium text-navy-950">
                          {unread.data > 99 ? "99+" : unread.data}
                          <span className="sr-only"> unread</span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

const menuItem =
  "flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm text-ink outline-none select-none data-[highlighted]:bg-canvas";
const menuPanel = "z-50 border border-ink bg-surface p-1 shadow-[4px_4px_0_0_rgb(14_23_48/0.15)]";

function OrganizationSwitcher({ me }: { me: Me }) {
  const router = useRouter();
  const switchOrganization = useSwitchOrganization();
  const current = activeMembership(me);
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex w-full items-center gap-3 border border-white/15 px-3 py-2.5 text-left hover:bg-white/5">
        <span className="min-w-0 flex-1">
          <span className="label-mono block text-white/45">
            {me.role ? humanize(me.role) : "No organization"}
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-white">
            {current?.organizationName ?? "Join or create one"}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-white/50" aria-hidden />
        <span className="sr-only">Switch organization</span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={6} className={cn(menuPanel, "w-64")}>
          <Dropdown.Label className="label-mono px-2.5 py-1.5 text-muted">
            Your organizations
          </Dropdown.Label>
          {me.memberships.length === 0 ? (
            <p className="px-2.5 py-1.5 text-sm text-muted">You have not joined one yet.</p>
          ) : null}
          {me.memberships.map((membership) => (
            <Dropdown.Item
              key={membership.organizationId}
              className={menuItem}
              disabled={switchOrganization.isPending}
              onSelect={() => {
                if (membership.organizationId === me.activeOrganizationId) return;
                switchOrganization.mutate(membership.organizationId, {
                  onSuccess: () => {
                    toast.success(`Switched to ${membership.organizationName}`);
                    router.push("/dashboard");
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                });
              }}
            >
              <span className="min-w-0 flex-1 truncate">{membership.organizationName}</span>
              {membership.organizationId === me.activeOrganizationId ? (
                <Check className="size-4 text-brand-600" aria-label="Active" />
              ) : null}
            </Dropdown.Item>
          ))}
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item className={menuItem} onSelect={() => router.push("/organizations/new")}>
            <Plus className="size-4 text-muted" aria-hidden />
            Create organization
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function UserMenu({ me }: { me: Me }) {
  const router = useRouter();
  const logout = useLogout();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex items-center gap-2.5 py-1 pr-1 pl-1 hover:bg-canvas">
        <span className="flex size-8 items-center justify-center bg-navy-900 font-mono text-xs font-medium text-white">
          {initials(me.user.fullName)}
        </span>
        <span className="hidden max-w-40 truncate text-sm font-semibold text-ink sm:block">
          {me.user.fullName}
        </span>
        <span className="sr-only">Account menu</span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className={cn(menuPanel, "w-60")}>
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold text-ink">{me.user.fullName}</p>
            <p className="truncate font-mono text-xs text-muted">{me.user.email}</p>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item className={menuItem} onSelect={() => router.push("/settings")}>
            <Settings className="size-4 text-muted" aria-hidden />
            Settings
          </Dropdown.Item>
          <Dropdown.Item
            className={menuItem}
            disabled={logout.isPending}
            onSelect={() => logout.mutate()}
          >
            <LogOut className="size-4 text-muted" aria-hidden />
            Sign out
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);
  const unread = useUnreadCount(!!me.activeOrganizationId && !!me.role);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 overflow-y-auto bg-navy-900 px-3 py-4">
      <Link href="/dashboard" className="px-2 pt-1" aria-label="CivicPulse overview">
        <Logo inverted />
      </Link>
      <OrganizationSwitcher me={me} />
      <NavLinks me={me} onNavigate={() => setMobileOpen(false)} />
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            className="absolute inset-0 bg-navy-950/60"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-72 max-w-[85%]">
            {sidebar}
            <button
              className="absolute top-4 right-3 p-1.5 text-white/70 hover:bg-white/10"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink/15 bg-surface px-4 sm:px-6">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            className="-ml-2 p-2 text-ink hover:bg-canvas"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <Link href="/dashboard" aria-label="CivicPulse home">
            <Logo />
          </Link>
        </div>
        <div className="hidden lg:block" />
        <div className="flex items-center gap-1">
          {me.activeOrganizationId && me.role ? (
            <Link
              href="/notifications"
              className="relative p-2 text-ink-soft hover:bg-canvas hover:text-ink"
              aria-label={unread.data ? `Notifications, ${unread.data} unread` : "Notifications"}
            >
              <Bell className="size-5" />
              {unread.data ? (
                <span className="absolute top-1.5 right-1.5 size-2 bg-signal ring-2 ring-surface" />
              ) : null}
            </Link>
          ) : null}
          <UserMenu me={me} />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
      <div className="min-w-0">
        {eyebrow ? <p className="label-mono mb-1 text-muted">{eyebrow}</p> : null}
        <h1 className="text-[26px] leading-tight font-extrabold text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const button =
    "border border-ink/70 px-3 py-1.5 text-sm font-semibold disabled:opacity-35 enabled:hover:bg-ink enabled:hover:text-white";
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
      <p className="font-mono text-xs text-muted">
        {total} total · page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <button className={button} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className={button} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
