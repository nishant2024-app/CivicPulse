"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import type { PublicTracking } from "@civicpulse/shared";
import { DueFlag, StatusTag, Timeline, TrackingId } from "@/components/complaints";
import { Logo } from "@/components/logo";
import { TrackForm } from "@/components/track-form";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

const OPEN = ["REPORTED", "VERIFIED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "REOPENED"];

export default function TrackingResultPage({
  params,
}: {
  params: Promise<{ trackingId: string }>;
}) {
  const { trackingId } = use(params);
  const tracking = useQuery({
    queryKey: ["tracking", trackingId],
    queryFn: () => api.get<PublicTracking>(`/tracking/${encodeURIComponent(trackingId)}`),
    retry: false,
  });
  const notFound = tracking.error instanceof ApiError && tracking.error.status === 404;
  const t = tracking.data;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-ink/15 bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <Link href="/" aria-label="CivicPulse home">
            <Logo />
          </Link>
          <Link href="/track" className="text-sm font-semibold text-ink hover:underline">
            Track another
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        {tracking.isPending ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : notFound ? (
          <div className="border border-line bg-surface p-8">
            <h1 className="text-2xl font-extrabold text-ink">No report with that ID</h1>
            <p className="mt-2 text-muted">
              Check the ID for typos. If it is correct, the organization may have switched public
              tracking off.
            </p>
            <div className="mt-6 max-w-md">
              <TrackForm defaultValue={trackingId} />
            </div>
          </div>
        ) : tracking.isError ? (
          <div className="border border-line bg-surface">
            <ErrorState
              message={errorMessage(tracking.error)}
              onRetry={() => void tracking.refetch()}
            />
          </div>
        ) : t ? (
          <article className="border-2 border-ink bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-line-strong px-6 py-4">
              <TrackingId id={t.trackingId} size="lg" />
              <StatusTag status={t.status} className="text-xs" />
            </div>
            <div className="px-6 py-6">
              <p className="label-mono text-muted">
                {t.organization} · {t.category}
              </p>
              <h1 className="mt-1.5 text-2xl leading-tight font-extrabold text-ink">{t.title}</h1>
              <p className="mt-3 flex items-start gap-2 text-sm text-ink-soft">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t.locationText}
              </p>
              <dl className="mt-6 grid gap-4 border-y border-line py-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="label-mono text-muted">Reported</dt>
                  <dd className="mt-0.5 text-ink">{formatDateTime(t.reportedAt)}</dd>
                </div>
                <div>
                  <dt className="label-mono text-muted">Handled by</dt>
                  <dd className="mt-0.5 text-ink">{t.department ?? "Not assigned yet"}</dd>
                </div>
                <div>
                  <dt className="label-mono text-muted">Target</dt>
                  <dd className="mt-0.5 text-ink">
                    {t.slaDueAt && OPEN.includes(t.status) ? (
                      <DueFlag
                        slaDueAt={t.slaDueAt}
                        isOverdue={new Date(t.slaDueAt) < new Date()}
                        status={t.status}
                      />
                    ) : t.slaDueAt ? (
                      formatDateTime(t.slaDueAt)
                    ) : (
                      "Set once verified"
                    )}
                  </dd>
                </div>
              </dl>
              <h2 className="mt-6 mb-4 text-base font-bold text-ink">Progress</h2>
              <Timeline
                entries={t.timeline.map((entry, index) => ({
                  key: String(index),
                  status: entry.status,
                  note: entry.note,
                  at: entry.at,
                }))}
              />
              {t.resolutionPhotos.length ? (
                <>
                  <h2 className="mt-8 mb-3 text-base font-bold text-ink">Work evidence</h2>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {t.resolutionPhotos.map((photo, index) => (
                      <li key={index}>
                        <a
                          href={photo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block border border-line-strong"
                        >
                          <img
                            src={photo.thumbnailUrl}
                            alt={`Photo ${index + 1} of the completed work`}
                            className="aspect-square w-full object-cover"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
            <p className="border-t border-line px-6 py-3 text-xs text-muted">
              This page never shows who reported the issue. Reported it yourself?{" "}
              <Link href="/login" className="font-semibold text-brand-600 hover:underline">
                Sign in
              </Link>{" "}
              to reply or reopen it.
            </p>
          </article>
        ) : null}
      </main>
    </div>
  );
}
