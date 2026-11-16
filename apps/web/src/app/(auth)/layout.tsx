import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-navy-900 p-10 text-white lg:flex">
        <Link href="/" aria-label="CivicPulse home">
          <Logo inverted />
        </Link>
        <div>
          <p className="text-3xl leading-snug font-semibold tracking-tight text-balance">
            The shortest path between &ldquo;this is broken&rdquo; and &ldquo;this is fixed&rdquo;.
          </p>
          <p className="mt-4 max-w-md text-white/65">
            Report an issue in a minute. See who is handling it. Know when it is done.
          </p>
        </div>
        <p className="text-sm text-white/45">
          Report problems. Track progress. Build better communities.
        </p>
      </aside>
      <main className="flex flex-col items-center justify-center bg-surface px-5 py-10">
        <Link href="/" className="mb-8 lg:hidden" aria-label="CivicPulse home">
          <Logo />
        </Link>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
