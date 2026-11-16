"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ClipboardList, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  type Category,
  type ComplaintSummary,
  type Pagination,
} from "@civicpulse/shared";
import { PageHeader, Pager } from "@/components/app-shell";
import { DueFlag, PriorityTag, STATUS_LABEL, StatusTag, TrackingId } from "@/components/complaints";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { cn, fromNow, humanize } from "@/lib/utils";

const VIEWS = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "unassigned", label: "Needs triage", staffOnly: true },
  { key: "overdue", label: "Overdue", staffOnly: true },
] as const;

function ComplaintList() {
  const { data: me } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const staff = can(me, "complaint:read:assigned");
  const [search, setSearch] = useState(params.get("q") ?? "");

  // Filters live in the URL so a filtered view can be shared and survives reload.
  function setParam(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    router.replace(`/complaints${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      if (search !== (params.get("q") ?? "")) setParam({ q: search || null });
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const query = params.toString();
  const complaints = useQuery({
    queryKey: ["complaints", "list", query],
    queryFn: () =>
      api.get<{ data: ComplaintSummary[]; pagination: Pagination }>(`/complaints?${query}`),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ data: Category[] }>("/organizations/current/categories"),
    select: (response) => response.data,
  });

  const filtered = ["q", "state", "status", "priority", "categoryId"].some((key) =>
    params.get(key),
  );
  const title =
    me?.role === "CITIZEN" ? "My reports" : me?.role === "FIELD_WORKER" ? "My work" : "Reports";

  return (
    <>
      <PageHeader
        title={title}
        description={
          me?.role === "CITIZEN"
            ? "Everything you have reported and where it stands."
            : me?.role === "FIELD_WORKER"
              ? "Reports assigned to you, plus anything you reported yourself."
              : me?.role === "DEPARTMENT_MANAGER"
                ? "Reports routed to your department."
                : "Every report in this organization."
        }
        action={
          can(me, "complaint:create") ? (
            <Button asChild>
              <Link href="/report">Report an issue</Link>
            </Button>
          ) : null
        }
      />

      <div className="border border-line bg-surface">
        <div
          className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-line px-3 pt-2"
          role="tablist"
          aria-label="View"
        >
          {VIEWS.filter((view) => !("staffOnly" in view) || staff).map((view) => {
            const active = (params.get("state") ?? "") === view.key;
            return (
              <button
                key={view.key}
                role="tab"
                aria-selected={active}
                onClick={() => setParam({ state: view.key || null, status: null })}
                className={cn(
                  "-mb-px border-b-[3px] px-3 py-2 text-sm font-semibold",
                  active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {view.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search reports"
              placeholder="Search title, description, location or tracking ID"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            aria-label="Status"
            value={params.get("status") ?? ""}
            onChange={(event) => setParam({ status: event.target.value || null, state: null })}
          >
            <option value="">Any status</option>
            {COMPLAINT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Category"
            value={params.get("categoryId") ?? ""}
            onChange={(event) => setParam({ categoryId: event.target.value || null })}
          >
            <option value="">Any category</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Priority"
            value={params.get("priority") ?? ""}
            onChange={(event) => setParam({ priority: event.target.value || null })}
          >
            <option value="">Any priority</option>
            {COMPLAINT_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {humanize(priority)}
              </option>
            ))}
          </Select>
        </div>

        {complaints.isPending ? (
          <div className="space-y-px">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex gap-4 border-b border-line px-5 py-4">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 flex-1" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </div>
        ) : complaints.isError ? (
          <ErrorState
            message={errorMessage(complaints.error)}
            onRetry={() => void complaints.refetch()}
          />
        ) : complaints.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={Search}
              title="Nothing matches these filters"
              description="Try a different search term or clear the filters."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    router.replace("/complaints");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title={me?.role === "FIELD_WORKER" ? "Nothing assigned to you yet" : "No reports yet"}
              description={
                me?.role === "CITIZEN"
                  ? "When you report a problem, it shows up here with its status."
                  : "Reports appear here as soon as someone files one."
              }
              action={
                can(me, "complaint:create") ? (
                  <Button asChild size="sm">
                    <Link href="/report">Report an issue</Link>
                  </Button>
                ) : null
              }
            />
          )
        ) : (
          <ul className={cn("divide-y divide-line", complaints.isPlaceholderData && "opacity-60")}>
            {complaints.data.data.map((complaint) => (
              <li key={complaint.id} className="relative">
                {complaint.isOverdue ? (
                  <span className="hazard absolute inset-y-0 left-0 w-1" aria-hidden />
                ) : null}
                <Link
                  href={`/complaints/${complaint.id}`}
                  className="grid gap-x-5 gap-y-2 px-5 py-3.5 hover:bg-canvas md:grid-cols-[8.5rem_1fr_auto]"
                >
                  <div className="flex items-center gap-3 md:block md:space-y-1.5">
                    <TrackingId id={complaint.trackingId} />
                    <div className="md:hidden">
                      <StatusTag status={complaint.status} />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{complaint.title}</p>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {complaint.category.name} · {complaint.locationText}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <PriorityTag priority={complaint.priority} />
                      <DueFlag
                        slaDueAt={complaint.slaDueAt}
                        isOverdue={complaint.isOverdue}
                        status={complaint.status}
                      />
                      {staff && complaint.department ? (
                        <span className="label-mono text-muted">
                          {complaint.department.name}
                          {complaint.assignedWorker
                            ? ` → ${complaint.assignedWorker.fullName}`
                            : ""}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="hidden text-right md:block">
                    <StatusTag status={complaint.status} />
                    <p className="mt-1.5 font-mono text-xs text-muted">
                      {fromNow(complaint.createdAt)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {complaints.data ? (
          <Pager
            page={complaints.data.pagination.page}
            totalPages={complaints.data.pagination.totalPages}
            total={complaints.data.pagination.total}
            onPage={(page) => setParam({ page: String(page) })}
          />
        ) : null}
      </div>
    </>
  );
}

export default function ComplaintsPage() {
  return (
    <Suspense>
      <ComplaintList />
    </Suspense>
  );
}
