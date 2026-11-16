"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Building2,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Me, Permission } from "@civicpulse/shared";
import { Logo } from "@/components/logo";
import { errorMessage } from "@/lib/api";
import { activeMembership, can, useLogout, useSwitchOrganization } from "@/lib/auth";
import { cn, humanize, initials } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only when the user holds this permission. */
  permission?: Permission;
}

// Only destinations that exist are listed; later phases add theirs here.
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-1">
      {NAV.filter((item) => !item.permission || can(me, item.permission)).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white",
            )}
          >
            <item.icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

const menuItem =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink outline-none select-none data-[highlighted]:bg-canvas";

function OrganizationSwitcher({ me }: { me: Me }) {
  const router = useRouter();
  const switchOrganization = useSwitchOrganization();
  const current = activeMembership(me);

  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white">
          <Building2 className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {current?.organizationName ?? "No organization"}
          </span>
          <span className="block truncate text-xs text-white/55">
            {me.role ? humanize(me.role) : "Not a member yet"}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-white/50" aria-hidden />
        <span className="sr-only">Switch organization</span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <Dropdown.Label className="px-2 py-1.5 text-xs font-medium text-muted">
            Your organizations
          </Dropdown.Label>
          {me.memberships.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted">You have not joined one yet.</p>
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
      <Dropdown.Trigger className="flex items-center gap-2 rounded-full p-1 pr-3 hover:bg-canvas">
        <span className="flex size-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">
          {initials(me.user.fullName)}
        </span>
        <span className="hidden max-w-40 truncate text-sm font-medium text-ink sm:block">
          {me.user.fullName}
        </span>
        <span className="sr-only">Account menu</span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={6}
          className="z-50 w-60 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <div className="px-2 py-2">
            <p className="truncate text-sm font-medium text-ink">{me.user.fullName}</p>
            <p className="truncate text-xs text-muted">{me.user.email}</p>
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

  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-navy-900 p-4">
      <Link href="/dashboard" className="px-1 pt-1" aria-label="CivicPulse overview">
        <Logo inverted />
      </Link>
      <OrganizationSwitcher me={me} />
      <NavLinks me={me} onNavigate={() => setMobileOpen(false)} />
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            className="absolute inset-0 bg-navy-950/50"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-72 max-w-[85%]">
            {sidebar}
            <button
              className="absolute top-4 right-3 rounded-md p-1.5 text-white/70 hover:bg-white/10"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 sm:px-6">
        <button
          className="rounded-md p-2 text-ink-soft hover:bg-canvas lg:hidden"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-5" />
        </button>
        <Link href="/dashboard" className="lg:hidden" aria-label="CivicPulse home">
          <Logo />
        </Link>
        <div className="hidden lg:block" />
        <UserMenu me={me} />
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
