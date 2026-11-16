import type { CategoryCount, TrendPoint } from "@civicpulse/shared";

const monthLabel = new Intl.DateTimeFormat("en", { month: "short" });

/** Reported vs resolved per month as paired bars, with the numbers always visible. */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const max = Math.max(1, ...data.flatMap((point) => [point.reported, point.resolved]));
  return (
    <figure>
      <div
        className="flex h-44 items-end gap-3 border-b-2 border-ink sm:gap-5"
        role="img"
        aria-label={`Reports per month: ${data.map((p) => `${p.month} ${p.reported} reported, ${p.resolved} resolved`).join("; ")}`}
      >
        {data.map((point) => (
          <div key={point.month} className="flex h-full flex-1 items-end justify-center gap-1">
            {(["reported", "resolved"] as const).map((series) => (
              <div key={series} className="flex h-full w-full max-w-7 flex-col justify-end">
                <span className="mb-1 text-center font-mono text-[11px] text-ink-soft">
                  {point[series]}
                </span>
                <div
                  className={series === "reported" ? "bg-navy-900" : "bg-signal"}
                  style={{
                    height: `${(point[series] / max) * 82}%`,
                    minHeight: point[series] ? 3 : 0,
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-3 sm:gap-5" aria-hidden>
        {data.map((point) => (
          <span key={point.month} className="label-mono flex-1 text-center text-muted">
            {monthLabel.format(new Date(`${point.month}-01T00:00:00`))}
          </span>
        ))}
      </div>
      <figcaption className="mt-3 flex gap-5 text-sm text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 bg-navy-900" /> Reported
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 bg-signal" /> Resolved
        </span>
      </figcaption>
    </figure>
  );
}

/** Categories as ranked horizontal bars; the open share is drawn inside each bar. */
export function CategoryBars({ data }: { data: CategoryCount[] }) {
  const rows = data.filter((row) => row.total > 0);
  const max = Math.max(1, ...rows.map((row) => row.total));
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li
          key={row.categoryId}
          className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm"
        >
          <span className="truncate text-ink">{row.name}</span>
          <span className="flex h-4 bg-canvas" aria-hidden>
            <span
              className="bg-navy-900"
              style={{ width: `${((row.total - row.open) / max) * 100}%` }}
            />
            <span className="bg-brand-500" style={{ width: `${(row.open / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-xs text-ink-soft">
            {row.total}
            <span className="sr-only"> reports, {row.open} open</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
