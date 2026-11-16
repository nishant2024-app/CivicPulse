import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { TrackForm } from "@/components/track-form";

export const metadata: Metadata = { title: "Track a report" };

export default function TrackPage() {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-ink/15">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <Link href="/" aria-label="CivicPulse home">
            <Logo />
          </Link>
          <Link href="/login" className="text-sm font-semibold text-ink hover:underline">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-5 py-16">
        <h1 className="text-3xl font-extrabold text-ink">Track a report</h1>
        <p className="mt-2 text-muted">
          Enter the tracking ID you received when the report was filed. No account needed.
        </p>
        <div className="mt-8">
          <TrackForm />
        </div>
      </main>
    </div>
  );
}
