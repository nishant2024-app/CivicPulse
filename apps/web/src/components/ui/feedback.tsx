import { AlertCircle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("animate-pulse rounded-md bg-line", className)} aria-hidden {...props} />
  );
}

const BADGE_TONES = {
  neutral: "bg-canvas text-ink-soft ring-line-strong",
  brand: "bg-brand-50 text-brand-700 ring-brand-100",
  success: "bg-success-50 text-success-700 ring-success-700/15",
  warning: "bg-warning-50 text-warning-700 ring-warning-700/15",
  danger: "bg-danger-50 text-danger-700 ring-danger-700/15",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof BADGE_TONES }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

const ALERT_TONES = {
  error: { icon: AlertCircle, classes: "border-danger-700/20 bg-danger-50 text-danger-700" },
  success: { icon: CheckCircle2, classes: "border-success-700/20 bg-success-50 text-success-700" },
  info: { icon: Info, classes: "border-brand-100 bg-brand-50 text-brand-700" },
} as const;

export function Alert({
  tone = "error",
  children,
  className,
}: {
  tone?: keyof typeof ALERT_TONES;
  children: ReactNode;
  className?: string;
}) {
  const { icon: Icon, classes } = ALERT_TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        classes,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon className="size-5" aria-hidden />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="flex size-11 items-center justify-center rounded-full bg-danger-50 text-danger-700">
        <AlertCircle className="size-5" aria-hidden />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-ink">Could not load this</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
