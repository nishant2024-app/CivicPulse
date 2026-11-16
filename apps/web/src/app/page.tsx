import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { TrackForm } from "@/components/track-form";
import { Button } from "@/components/ui/button";

const PATH = [
  {
    who: "Citizen",
    what: "Reports the problem",
    detail:
      "Category, a few words, the spot on a map, a photo. A tracking ID comes back immediately.",
  },
  {
    who: "Administrator",
    what: "Verifies and routes it",
    detail:
      "Confirms it is real, sets the priority, and sends it to the department that owns that kind of problem. The clock starts here.",
  },
  {
    who: "Field worker",
    what: "Does the work",
    detail: "Accepts the job, posts progress, uploads a photo of the finished repair.",
  },
  {
    who: "Citizen",
    what: "Confirms or reopens",
    detail:
      "If the fix held, close it and rate it. If not, reopen it with one line and it goes back in the queue.",
  },
];

const CATEGORIES = [
  "Roads",
  "Garbage",
  "Water supply",
  "Drainage",
  "Electricity",
  "Streetlights",
  "Public property",
  "College infrastructure",
];

const COMMITMENTS = [
  [
    "Nothing disappears",
    "Every status change is written to a history that cannot be edited or deleted — not by staff, not by administrators.",
  ],
  [
    "Deadlines are visible",
    "Each report gets a resolution target when it is verified. Overdue work is flagged to the people responsible.",
  ],
  [
    "Reporters stay private",
    "The public tracking page shows progress only. No names, no contact details, no exact coordinates.",
  ],
  [
    "Organizations stay separate",
    "A campus cannot see a housing society's reports. The database enforces that boundary itself.",
  ],
];

export default function LandingPage() {
  return (
    <div className="bg-surface">
      <header className="border-b border-ink/15">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account">
            <Button asChild variant="ghost">
              <Link href="/track">Track a report</Link>
            </Button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
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
          <div className="mx-auto grid max-w-6xl gap-10 px-5 pt-16 pb-14 lg:grid-cols-[1.25fr_1fr] lg:pt-24 lg:pb-20">
            <div className="min-w-0">
              <p className="label-mono text-signal">Community issue reporting</p>
              <h1 className="mt-4 text-[34px] leading-[1.04] font-extrabold text-balance [font-stretch:110%] sm:text-6xl sm:[font-stretch:116%]">
                Report problems. Track progress. Build better communities.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-white/75">
                The streetlight that has been out for a month. The pipe leaking by the hostel.
                CivicPulse puts the report in front of the team that fixes it and keeps the whole
                trail on record.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" variant="signal">
                  <Link href="/register">
                    Report an issue <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/40 bg-transparent text-white hover:bg-white hover:text-navy-900"
                >
                  <Link href="/register?intent=organization">Set up your organization</Link>
                </Button>
              </div>
            </div>
            <div className="min-w-0 self-end border border-white/20 bg-navy-800 p-5 sm:p-6">
              <h2 className="text-xl font-bold">Already reported something?</h2>
              <p className="mt-1.5 mb-5 text-sm text-white/65">
                Check where it stands. No account needed.
              </p>
              <TrackForm dark />
            </div>
          </div>
          <div className="hazard h-2.5" aria-hidden />
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20" aria-labelledby="path">
          <div className="grid gap-10 lg:grid-cols-[18rem_1fr]">
            <div>
              <h2 id="path" className="text-3xl leading-tight font-extrabold text-ink">
                The path of one report
              </h2>
              <p className="mt-3 text-muted">
                Four hand-offs. Each one is recorded, with a name and a time.
              </p>
            </div>
            <ol className="border-t-2 border-ink">
              {PATH.map((step, index) => (
                <li
                  key={index}
                  className="grid gap-x-6 gap-y-1 border-b border-line py-5 sm:grid-cols-[3rem_10rem_1fr]"
                >
                  <span className="font-mono text-sm text-muted">0{index + 1}</span>
                  <span className="label-mono pt-0.5 text-brand-700">{step.who}</span>
                  <div>
                    <h3 className="text-lg font-bold text-ink">{step.what}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-y border-ink/15 bg-canvas" aria-labelledby="covers">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 id="covers" className="label-mono text-muted">
              What people report
            </h2>
            <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-display text-2xl leading-snug font-bold text-ink [font-stretch:108%] sm:text-3xl">
              {CATEGORIES.map((category, index) => (
                <li key={category} className="flex gap-3">
                  {category}
                  {index < CATEGORIES.length - 1 ? (
                    <span className="text-signal" aria-hidden>
                      /
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-4 max-w-2xl text-sm text-muted">
              Built for college campuses and residential societies first; the same setup works for
              villages, municipal wards and private institutions. Each organization runs its own
              departments, categories and deadlines.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20" aria-labelledby="commitments">
          <h2 id="commitments" className="text-3xl font-extrabold text-ink">
            What the system guarantees
          </h2>
          <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
            {COMMITMENTS.map(([title, body]) => (
              <div key={title} className="border-l-4 border-navy-900 pl-5">
                <dt className="text-lg font-bold text-ink">{title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-ink-soft">{body}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t-2 border-ink">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>Open-source software for community maintenance.</p>
        </div>
      </footer>
    </div>
  );
}
