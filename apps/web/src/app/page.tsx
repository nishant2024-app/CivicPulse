import {
  ArrowRight,
  Building2,
  Camera,
  ClipboardCheck,
  Eye,
  GraduationCap,
  Home,
  Landmark,
  MapPin,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: Camera,
    title: "Report",
    body: "Describe the problem, add a photo and mark the spot. It takes about a minute and you get a tracking ID straight away.",
  },
  {
    icon: ClipboardCheck,
    title: "Triage",
    body: "The organization verifies the report, sets a priority and routes it to the department that can fix it.",
  },
  {
    icon: Wrench,
    title: "Resolve",
    body: "A field worker picks it up, posts progress and uploads evidence when the work is done.",
  },
  {
    icon: Eye,
    title: "Track",
    body: "Every status change is recorded. Follow along with your tracking ID, and reopen the report if the fix did not hold.",
  },
];

const AUDIENCES = [
  { icon: GraduationCap, label: "College campuses" },
  { icon: Home, label: "Residential societies" },
  { icon: Users, label: "Villages and communities" },
  { icon: Landmark, label: "Municipal bodies" },
  { icon: Building2, label: "Private institutions" },
];

const PRINCIPLES = [
  {
    icon: ShieldCheck,
    title: "Each organization's data stays its own",
    body: "Isolation is enforced by the database itself, not only by application code.",
  },
  {
    icon: ClipboardCheck,
    title: "A history nobody can rewrite",
    body: "Status changes are append-only. What happened, when and by whom stays on record.",
  },
  {
    icon: MapPin,
    title: "Private by default",
    body: "Public tracking shows progress, never the reporter's name, contact details or exact location.",
  },
];

export default function LandingPage() {
  return (
    <div className="bg-surface">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="flex items-center gap-2" aria-label="Account">
            <Button asChild variant="ghost">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="bg-navy-900 text-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
            <div>
              <p className="text-sm font-medium tracking-wide text-brand-100 uppercase">
                Community issue reporting
              </p>
              <h1 className="mt-4 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
                Report problems. Track progress. Build better communities.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-white/75">
                A broken streetlight, a leaking pipe, a pothole by the gate. CivicPulse gets the
                report to the people who can fix it, and shows everyone what happens next.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/register">
                    Report an issue <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/25 bg-transparent text-white hover:bg-white/10"
                >
                  <Link href="/register?intent=organization">Set up your organization</Link>
                </Button>
              </div>
            </div>

            {/* Illustrative timeline: shows the lifecycle, not live data. */}
            <div
              className="self-center rounded-2xl border border-white/10 bg-navy-800 p-6"
              role="img"
              aria-label="Example of a complaint moving from reported to resolved"
            >
              <p className="font-mono text-xs text-white/50">How a report moves</p>
              <ol className="mt-5 space-y-5">
                {[
                  ["Reported", "Citizen submits with a photo and location"],
                  ["Verified", "Organization confirms and sets priority"],
                  ["Assigned", "Routed to the right department and worker"],
                  ["In progress", "Work is under way on site"],
                  ["Resolved", "Evidence uploaded, reporter notified"],
                ].map(([status, detail], index, all) => (
                  <li key={status} className="relative flex gap-4">
                    {index < all.length - 1 ? (
                      <span
                        className="absolute top-6 left-[9px] h-full w-px bg-white/15"
                        aria-hidden
                      />
                    ) : null}
                    <span
                      className={`relative mt-1 size-[19px] shrink-0 rounded-full border-2 ${
                        index === all.length - 1
                          ? "border-brand-500 bg-brand-500"
                          : "border-white/40 bg-navy-800"
                      }`}
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-medium">{status}</p>
                      <p className="text-sm text-white/60">{detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight text-ink">
            From report to resolution
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            One clear path, visible to the person who reported and the people responsible.
          </p>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-line p-5">
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <step.icon className="size-5" aria-hidden />
                  </span>
                  <span className="font-mono text-sm text-muted">0{index + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold text-ink">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-line bg-canvas" aria-labelledby="built-for">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 id="built-for" className="text-2xl font-semibold tracking-tight text-ink">
              Built for any community that maintains shared spaces
            </h2>
            <ul className="mt-8 flex flex-wrap gap-3">
              {AUDIENCES.map((audience) => (
                <li
                  key={audience.label}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft"
                >
                  <audience.icon className="size-4 text-brand-600" aria-hidden />
                  {audience.label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20" aria-labelledby="principles">
          <h2 id="principles" className="text-2xl font-semibold tracking-tight text-ink">
            Trust is part of the design
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title}>
                <principle.icon className="size-6 text-brand-600" aria-hidden />
                <h3 className="mt-3 font-semibold text-ink">{principle.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{principle.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <Logo className="text-sm" />
          <p>Open-source community issue reporting.</p>
        </div>
      </footer>
    </div>
  );
}
