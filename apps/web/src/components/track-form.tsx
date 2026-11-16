"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PATTERN = /^CP-[0-9A-HJKMNP-TV-Z]{10}$/;

/** Accepts the ID with or without the prefix, in any letter case. */
function normalize(input: string): string {
  const compact = input.trim().toUpperCase().replace(/\s+/g, "");
  return compact.startsWith("CP-")
    ? compact
    : compact.startsWith("CP")
      ? `CP-${compact.slice(2)}`
      : `CP-${compact}`;
}

export function TrackForm({ dark, defaultValue = "" }: { dark?: boolean; defaultValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const id = normalize(value);
        if (!PATTERN.test(id)) {
          setError("A tracking ID looks like CP-7K3M9QX2TB. Check it and try again.");
          return;
        }
        router.push(`/track/${id}`);
      }}
    >
      <label
        htmlFor="tracking-id"
        className={cn("label-mono block", dark ? "text-white/60" : "text-muted")}
      >
        Tracking ID
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="tracking-id"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="CP-7K3M9QX2TB"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "tracking-id-error" : undefined}
          className={cn(
            "h-11 min-w-0 flex-1 rounded-[3px] border px-3 font-mono text-base tracking-wide uppercase placeholder:normal-case",
            dark
              ? "border-white/30 bg-navy-950 text-white placeholder:text-white/35"
              : "border-line-strong bg-surface text-ink placeholder:text-muted",
          )}
        />
        <Button type="submit" size="lg" variant={dark ? "signal" : "primary"}>
          Track
        </Button>
      </div>
      {error ? (
        <p
          id="tracking-id-error"
          role="alert"
          className={cn("mt-2 text-sm", dark ? "text-signal" : "text-danger-700")}
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
