"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import type { AuditLog, Pagination } from "@civicpulse/shared";
import { PageHeader, Pager } from "@/components/app-shell";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

/** One readable line per entry, built from the recorded metadata. */
function describeEntry(entry: AuditLog): string {
  const m = entry.metadata as Record<string, unknown>;
  const ref = typeof m.trackingId === "string" ? ` ${m.trackingId}` : "";
  switch (entry.action) {
    case "complaint.created":
      return `filed report${ref}`;
    case "complaint.status_changed":
      return `moved report${ref} from ${String(m.from).toLowerCase().replace("_", " ")} to ${String(m.to).toLowerCase().replace("_", " ")}`;
    case "complaint.reassigned":
      return "reassigned a report";
    case "complaint.triage_updated":
      return "changed a report's priority or category";
    case "department.created":
      return `created department “${String(m.name)}”`;
    case "department.updated":
      return "updated a department";
    case "department.removed":
      return "removed a department";
    case "member.updated": {
      const to = m.to as { role?: string; status?: string } | undefined;
      return `changed a member to ${String(to?.role ?? "")
        .toLowerCase()
        .replace("_", " ")}${to?.status === "SUSPENDED" ? " (suspended)" : ""}`;
    }
    case "organization.created":
      return "created the organization";
    case "organization.updated":
      return "updated organization settings";
    case "user.registered":
      return "registered";
    default:
      return entry.action.replace(".", ": ").replaceAll("_", " ");
  }
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ["audit", page],
    queryFn: () =>
      api.get<{ data: AuditLog[]; pagination: Pagination }>(`/audit-logs?page=${page}&pageSize=30`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Audit log"
        description="A permanent record of who did what. Entries cannot be edited or deleted."
      />
      <Card>
        {audit.isPending ? (
          <CardBody className="space-y-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </CardBody>
        ) : audit.isError ? (
          <ErrorState message={errorMessage(audit.error)} onRetry={() => void audit.refetch()} />
        ) : audit.data.data.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No activity recorded yet"
            description="Actions in this organization are listed here as they happen."
          />
        ) : (
          <>
            <ol className="divide-y divide-line">
              {audit.data.data.map((entry) => (
                <li
                  key={entry.id}
                  className="grid gap-x-5 gap-y-0.5 px-5 py-2.5 text-sm sm:grid-cols-[11rem_1fr]"
                >
                  <time
                    className="font-mono text-xs leading-5 text-muted"
                    dateTime={entry.createdAt}
                  >
                    {formatDateTime(entry.createdAt)}
                  </time>
                  <p className="text-ink-soft">
                    <span className="font-semibold text-ink">
                      {entry.actor?.fullName ?? "System"}
                    </span>{" "}
                    {describeEntry(entry)}
                  </p>
                </li>
              ))}
            </ol>
            <Pager
              page={audit.data.pagination.page}
              totalPages={audit.data.pagination.totalPages}
              total={audit.data.pagination.total}
              onPage={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
