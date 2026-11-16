import { Clock } from "lucide-react";
import type { ComplaintPriority, ComplaintStatus } from "@civicpulse/shared";
import { cn, formatDateTime, fromNow } from "@/lib/utils";

export const STATUS_LABEL: Record<ComplaintStatus, string> = {
  REPORTED: "Reported",
  VERIFIED: "Verified",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REJECTED: "Rejected",
  REOPENED: "Reopened",
};

/** Verb shown on the button that moves a complaint to the status. */
export const STATUS_ACTION: Record<ComplaintStatus, string> = {
  REPORTED: "Report",
  VERIFIED: "Verify",
  ASSIGNED: "Assign",
  IN_PROGRESS: "Start work",
  ON_HOLD: "Put on hold",
  RESOLVED: "Mark resolved",
  CLOSED: "Confirm and close",
  REJECTED: "Reject",
  REOPENED: "Reopen",
};

const STATUS_STYLE: Record<ComplaintStatus, { box: string; dot: string }> = {
  REPORTED: { box: "bg-surface text-ink-soft ring-line-strong", dot: "bg-muted" },
  VERIFIED: { box: "bg-brand-50 text-brand-700 ring-brand-100", dot: "bg-brand-600" },
  ASSIGNED: { box: "bg-brand-50 text-brand-700 ring-brand-100", dot: "bg-navy-800" },
  IN_PROGRESS: { box: "bg-signal-soft text-warning-700 ring-signal", dot: "bg-signal" },
  ON_HOLD: { box: "bg-surface text-warning-700 ring-warning-700/40", dot: "bg-warning-700" },
  RESOLVED: { box: "bg-success-50 text-success-700 ring-success-700/25", dot: "bg-success-700" },
  CLOSED: { box: "bg-ink text-white ring-ink", dot: "bg-white" },
  REJECTED: { box: "bg-danger-50 text-danger-700 ring-danger-700/25", dot: "bg-danger-600" },
  REOPENED: { box: "bg-surface text-danger-700 ring-danger-600", dot: "bg-danger-600" },
};

export function StatusTag({ status, className }: { status: ComplaintStatus; className?: string }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "label-mono inline-flex items-center gap-1.5 px-1.5 py-[3px] font-medium whitespace-nowrap ring-1 ring-inset",
        style.box,
        className,
      )}
    >
      <span className={cn("size-1.5", style.dot)} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_BARS: Record<ComplaintPriority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/** Priority as a four-step gauge plus its name: readable without relying on colour. */
export function PriorityTag({ priority }: { priority: ComplaintPriority }) {
  const filled = PRIORITY_BARS[priority];
  const tone =
    priority === "CRITICAL" ? "bg-danger-600" : priority === "HIGH" ? "bg-signal" : "bg-ink-soft";
  return (
    <span className="label-mono inline-flex items-center gap-1.5 whitespace-nowrap text-ink-soft">
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            style={{ height: 3 + step * 2 }}
            className={cn("w-[3px]", step <= filled ? tone : "bg-line-strong")}
          />
        ))}
      </span>
      {priority.toLowerCase()}
    </span>
  );
}

/** Tracking IDs read like a ticket stub: monospaced, dashed edge. */
export function TrackingId({ id, size = "sm" }: { id: string; size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-block border border-dashed border-line-strong bg-surface font-mono font-medium tracking-wide text-ink",
        size === "lg" ? "px-3 py-1.5 text-xl" : "px-1.5 py-0.5 text-xs",
      )}
    >
      {id}
    </span>
  );
}

const OPEN: ComplaintStatus[] = [
  "REPORTED",
  "VERIFIED",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "REOPENED",
];

/** Deadline indicator. A deadline only means something while the work is still open. */
export function DueFlag({
  slaDueAt,
  isOverdue,
  status,
}: {
  slaDueAt: string | null;
  isOverdue: boolean;
  status: ComplaintStatus;
}) {
  if (!slaDueAt || !OPEN.includes(status)) return null;
  return isOverdue ? (
    <span className="label-mono inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-danger-700">
      <span className="hazard h-2.5 w-4" aria-hidden />
      Overdue {fromNow(slaDueAt).replace(" ago", "")}
    </span>
  ) : (
    <span className="label-mono inline-flex items-center gap-1 whitespace-nowrap text-muted">
      <Clock className="size-3" aria-hidden />
      Due {fromNow(slaDueAt)}
    </span>
  );
}

export interface TimelineEntry {
  key: string;
  status: ComplaintStatus;
  note: string | null;
  at: string;
  by?: string | null;
}

/** Status history as a route line: each stop is a status the complaint passed through. */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative">
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        return (
          <li key={entry.key} className="relative flex gap-4 pb-6 last:pb-0">
            {!last ? (
              <span className="absolute top-4 bottom-0 left-[6px] w-[2px] bg-ink" aria-hidden />
            ) : null}
            <span
              className={cn(
                "relative mt-[5px] size-3.5 shrink-0 border-2 border-ink",
                last ? "bg-signal" : "bg-surface",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <p className="font-semibold text-ink">{STATUS_LABEL[entry.status]}</p>
                <time dateTime={entry.at} className="font-mono text-xs text-muted">
                  {formatDateTime(entry.at)}
                </time>
              </div>
              {entry.by ? <p className="text-sm text-muted">by {entry.by}</p> : null}
              {entry.note ? (
                <p className="mt-1.5 border-l-2 border-line-strong pl-3 text-sm text-ink-soft">
                  {entry.note}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
