"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  type Category,
  type ComplaintSummary,
  type Pagination,
} from "@civicpulse/shared";
import { PageHeader, Pager } from "@/components/app-shell";
import { DueFlag, PriorityTag, STATUS_LABEL, StatusTag, TrackingId } from "@/components/complaints";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { cn, humanize } from "@/lib/utils";

interface Segment {
  text: string;
  match: boolean;
}
type Hit = ComplaintSummary & { highlights: { title?: Segment[]; description?: Segment[] } };
interface SearchResponse {
  data: Hit[];
  pagination: Pagination;
  meta: { engine: "opensearch" | "postgres"; degraded: boolean; tookMs: number };
}

/** Matches arrive as plain segments, so no markup from the server is ever rendered. */
function Highlighted({ segments, fallback }: { segments?: Segment[]; fallback: string }) {
  if (!segments?.length) return <>{fallback}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className="bg-signal-soft px-0.5 text-ink">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function SearchResults() {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");

  function setParam(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    router.replace(`/search${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      if (text !== (params.get("q") ?? "")) setParam({ q: text || null });
    }, 350);
    return () => clearTimeout(handle);
  }, [text]);

  const query = params.toString();
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => api.get<SearchResponse>(`/search/complaints?${query}`),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ data: Category[] }>("/organizations/current/categories"),
    select: (response) => response.data,
  });

  return (
    <>
      <PageHeader
        title="Search"
        description="Find reports by words, tracking ID, place or status. Typos are forgiven."
      />
      <Card>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <Input
            type="search"
            aria-label="Search reports"
            placeholder="Try “pothole”, “library lamp” or a tracking ID"
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoFocus
          />
          <Select
            aria-label="Status"
            value={params.get("status") ?? ""}
            onChange={(e) => setParam({ status: e.target.value || null })}
          >
            <option value="">Any status</option>
            {COMPLAINT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Category"
            value={params.get("categoryId") ?? ""}
            onChange={(e) => setParam({ categoryId: e.target.value || null })}
          >
            <option value="">Any category</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Priority"
            value={params.get("priority") ?? ""}
            onChange={(e) => setParam({ priority: e.target.value || null })}
          >
            <option value="">Any priority</option>
            {COMPLAINT_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {humanize(priority)}
              </option>
            ))}
          </Select>
        </div>

        {results.isPending ? (
          <div className="space-y-px">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="border-b border-line px-5 py-4">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="mt-2 h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : results.isError ? (
          <ErrorState
            message={errorMessage(results.error)}
            onRetry={() => void results.refetch()}
          />
        ) : results.data.data.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No reports match"
            description="Check the spelling, or remove a filter. Search covers titles, descriptions, places and categories."
          />
        ) : (
          <>
            <p className="flex items-center justify-between border-b border-line px-5 py-2 font-mono text-xs text-muted">
              <span>
                {results.data.pagination.total} result
                {results.data.pagination.total === 1 ? "" : "s"} · {results.data.meta.tookMs} ms
              </span>
              <span
                title={
                  results.data.meta.degraded
                    ? "OpenSearch is unreachable; PostgreSQL answered instead"
                    : undefined
                }
              >
                {results.data.meta.engine === "opensearch"
                  ? "OpenSearch"
                  : results.data.meta.degraded
                    ? "PostgreSQL (fallback)"
                    : "PostgreSQL"}
              </span>
            </p>
            <ul className={cn("divide-y divide-line", results.isPlaceholderData && "opacity-60")}>
              {results.data.data.map((hit) => (
                <li key={hit.id}>
                  <Link
                    href={`/complaints/${hit.id}`}
                    className="block px-5 py-3.5 hover:bg-canvas"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <p className="font-semibold text-ink">
                        <Highlighted segments={hit.highlights.title} fallback={hit.title} />
                      </p>
                      <StatusTag status={hit.status} />
                    </div>
                    {hit.highlights.description ? (
                      <p className="mt-1 text-sm text-ink-soft">
                        <Highlighted segments={hit.highlights.description} fallback="" />
                      </p>
                    ) : null}
                    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <TrackingId id={hit.trackingId} />
                      <span className="text-sm text-muted">
                        {hit.category.name} · {hit.locationText}
                      </span>
                      <PriorityTag priority={hit.priority} />
                      <DueFlag
                        slaDueAt={hit.slaDueAt}
                        isOverdue={hit.isOverdue}
                        status={hit.status}
                      />
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pager
              page={results.data.pagination.page}
              totalPages={results.data.pagination.totalPages}
              total={results.data.pagination.total}
              onPage={(page) => setParam({ page: String(page) })}
            />
          </>
        )}
      </Card>
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
