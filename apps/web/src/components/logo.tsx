import { cn } from "@/lib/utils";

/** Wordmark with a pulse trace cut into a road-sign plate. */
export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 34 26" className="h-[22px] w-auto" aria-hidden>
        <rect
          width="34"
          height="26"
          rx="2"
          className={inverted ? "fill-signal" : "fill-navy-900"}
        />
        <path
          d="M4 14h6l2.5-7 5 13 3.5-9 1.5 3H30"
          fill="none"
          className={inverted ? "stroke-navy-950" : "stroke-signal"}
          strokeWidth="2.6"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
      <span
        className={cn(
          "font-display text-[17px] font-extrabold tracking-tight [font-stretch:112%]",
          inverted ? "text-white" : "text-navy-900",
        )}
      >
        CivicPulse
      </span>
    </span>
  );
}
