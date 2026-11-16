import { cn } from "@/lib/utils";

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect
          width="32"
          height="32"
          rx="8"
          className={inverted ? "fill-white/10" : "fill-navy-900"}
        />
        <path
          d="M5 17h5l2.5-7 4.5 13 3-9 1.5 3H27"
          fill="none"
          stroke="#6f97ff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={inverted ? "text-white" : "text-navy-900"}>CivicPulse</span>
    </span>
  );
}
