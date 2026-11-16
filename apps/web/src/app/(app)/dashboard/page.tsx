"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Building2, ClipboardList } from "lucide-react";
import Link from "next/link";
import type {
  AnalyticsOverview,
  CategoryCount,
  ComplaintSummary,
  DepartmentPerformance,
  Me,
  Pagination,
  TrendPoint,
} from "@civicpulse/shared";
import { PageHeader } from "@/components/app-shell";
import { CategoryBars, TrendChart } from "@/components/charts";
import { DueFlag, StatusTag, TrackingId } from "@/components/complaints";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { api, errorMessage } from "@/lib/api";
import { activeMembership, can, useMe } from "@/lib/auth";
import { cn, formatDuration, fromNow } from "@/lib/utils";

type List = { data: ComplaintSummary[]; pagination: Pagination };

function Figure({
  label,
  value,
  href,
  alert,
  note,
}: {
  label: string;
  value: string;
  href?: string;
  alert?: boolean;
  note?: string;
}) {
  const body = (
    <>
      <p className="label-mono text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-[34px] leading-none font-extrabold [font-stretch:108%]",
          alert ? "text-danger-700" : "text-ink",
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-1.5 text-xs text-muted">{note}</p> : null}
    </>
  );
  const classes = cn("relative block bg-surface px-4 py-4", href && "hover:bg-canvas");
  return href ? (
    <Link href={href} className={classes}>
      {alert ? <span className="hazard absolute inset-x-0 top-0 h-1" aria-hidden /> : null}
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

function RecentReports({
  title,
  query,
  emptyTitle,
  emptyText,
}: {
  title: string;
  query: string;
  emptyTitle: string;
  emptyText: string;
}) {
  const reports = useQuery({
    queryKey: ["complaints", "list", query],
    queryFn: () => api.get<List>(`/complaints?${query}`),
  });
  return (
    <Card>
      <CardHeader
        title={title}
        action={
          <Link
            href={`/complaints?${query.replace(/&?pageSize=\d+/, "")}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
          >
            View all <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />
      {reports.isPending ? (
        <CardBody className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardBody>
      ) : reports.isError ? (
        <ErrorState message={errorMessage(reports.error)} onRetry={() => void reports.refetch()} />
      ) : reports.data.data.length === 0 ? (
        <EmptyState icon={ClipboardList} title={emptyTitle} description={emptyText} />
      ) : (
        <ul className="divide-y divide-line">
          {reports.data.data.map((report) => (
            <li key={report.id}>
              <Link
                href={`/complaints/${report.id}`}
                className="flex items-center gap-4 px-5 py-3 hover:bg-canvas"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{report.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <TrackingId id={report.trackingId} />
                    <DueFlag
                      slaDueAt={report.slaDueAt}
                      isOverdue={report.isOverdue}
                      status={report.status}
                    />
                    <span className="font-mono text-xs text-muted">
                      {fromNow(report.createdAt)}
                    </span>
                  </p>
                </div>
                <StatusTag status={report.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StaffAnalytics({ me }: { me: Me }) {
  const overview = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api.get<AnalyticsOverview>("/analytics/overview"),
  });
  const trends = useQuery({
    queryKey: ["analytics", "trends"],
    queryFn: () => api.get<{ data: TrendPoint[] }>("/analytics/trends?months=6"),
    select: (r) => r.data,
  });
  const categories = useQuery({
    queryKey: ["analytics", "categories"],
    queryFn: () => api.get<{ data: CategoryCount[] }>("/analytics/categories"),
    select: (r) => r.data,
  });
  const departments = useQuery({
    queryKey: ["analytics", "departments"],
    queryFn: () => api.get<{ data: DepartmentPerformance[] }>("/analytics/departments"),
    select: (r) => r.data,
  });

  if (overview.isError) {
    return (
      <Card>
        <ErrorState
          message={errorMessage(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      </Card>
    );
  }
  const o = overview.data;
  const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

  return (
    <>
      <section
        aria-label="Key figures"
        className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-3 xl:grid-cols-6"
      >
        {!o ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="bg-surface p-4">
              <Skeleton className="h-14 w-full" />
            </div>
          ))
        ) : (
          <>
            <Figure
              label="Open"
              value={String(o.open)}
              href="/complaints?state=open"
              note={`${o.total} reported in total`}
            />
            <Figure
              label="Needs triage"
              value={String(o.unassigned)}
              href="/complaints?state=unassigned"
              note="Not yet assigned"
            />
            <Figure
              label="Overdue"
              value={String(o.overdue)}
              href="/complaints?state=overdue"
              alert={o.overdue > 0}
              note="Past resolution target"
            />
            <Figure label="Resolved" value={String(o.resolved)} note={`${o.rejected} rejected`} />
            <Figure
              label="Resolution rate"
              value={percent(o.resolutionRate)}
              note="Of accepted reports"
            />
            <Figure
              label="Avg. time to resolve"
              value={
                o.averageResolutionHours === null ? "—" : formatDuration(o.averageResolutionHours)
              }
              note={
                o.ratingCount
                  ? `Rated ${o.averageRating!.toFixed(1)}/5 by ${o.ratingCount}`
                  : "No ratings yet"
              }
            />
          </>
        )}
      </section>

      {o && o.total === 0 ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="No reports yet"
            description="Charts appear once people start reporting. Share your organization's address so citizens can register."
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Last six months"
              description="Reports filed and reports resolved, by month."
            />
            <CardBody>
              {trends.data ? (
                <TrendChart data={trends.data} />
              ) : (
                <Skeleton className="h-52 w-full" />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="By category" description="Dark: closed out. Blue: still open." />
            <CardBody>
              {categories.data ? (
                <CategoryBars data={categories.data} />
              ) : (
                <Skeleton className="h-52 w-full" />
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {can(me, "complaint:read:all") && departments.data ? (
        <Card>
          <CardHeader title="Departments" description="Workload and speed of each department." />
          {departments.data.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No departments yet"
              description="Departments are the teams that resolve reports. Create one, then add its manager and field workers."
              action={
                <Button asChild size="sm">
                  <Link href="/departments">Set up departments</Link>
                </Button>
              }
            />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Department", "Open", "Overdue", "Resolved", "Avg. time"].map(
                      (heading, i) => (
                        <th
                          key={heading}
                          scope="col"
                          className={cn(
                            "label-mono px-5 py-2.5 font-medium text-muted",
                            i > 0 && "text-right",
                          )}
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line font-mono">
                  {departments.data.map((row) => (
                    <tr key={row.departmentId}>
                      <th
                        scope="row"
                        className="px-5 py-3 text-left font-sans font-semibold text-ink"
                      >
                        {row.name}
                      </th>
                      <td className="px-5 py-3 text-right">{row.open}</td>
                      <td
                        className={cn(
                          "px-5 py-3 text-right",
                          row.overdue > 0 && "font-medium text-danger-700",
                        )}
                      >
                        {row.overdue}
                      </td>
                      <td className="px-5 py-3 text-right">{row.resolved}</td>
                      <td className="px-5 py-3 text-right">
                        {row.averageResolutionHours === null
                          ? "—"
                          : formatDuration(row.averageResolutionHours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}

export default function DashboardPage() {
  const { data: me } = useMe();
  if (!me) return null;
  const firstName = me.user.fullName.split(" ")[0];
  const organization = activeMembership(me);

  if (!me.activeOrganizationId || !me.role) {
    return (
      <>
        <PageHeader title={`Welcome, ${firstName}`} />
        <Card>
          <EmptyState
            icon={Building2}
            title="You are not part of an organization yet"
            description="Create one for your campus, society or community. You will be its administrator and can bring in your team."
            action={
              <Button asChild>
                <Link href="/organizations/new">Create organization</Link>
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const report = can(me, "complaint:create") ? (
    <Button asChild size="lg">
      <Link href="/report">Report an issue</Link>
    </Button>
  ) : null;

  if (can(me, "analytics:read")) {
    return (
      <>
        <PageHeader
          eyebrow={organization?.organizationName}
          title="Overview"
          description="Live figures from this organization's reports."
          action={report}
        />
        <div className="space-y-6">
          <StaffAnalytics me={me} />
          <RecentReports
            title="Waiting for triage"
            query="state=unassigned&sort=createdAt&order=asc&pageSize=5"
            emptyTitle="Nothing is waiting"
            emptyText="New reports that need verifying or assigning show up here."
          />
        </div>
      </>
    );
  }

  if (me.role === "FIELD_WORKER") {
    return (
      <>
        <PageHeader
          eyebrow={organization?.organizationName}
          title={`Your work, ${firstName}`}
          description="Start with whatever is closest to its deadline."
          action={report}
        />
        <RecentReports
          title="Assigned to you"
          query="state=open&sort=slaDueAt&order=asc&pageSize=10"
          emptyTitle="Nothing assigned right now"
          emptyText="When a report is assigned to you, it appears here and you get a notification."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={organization?.organizationName}
        title={`Hello, ${firstName}`}
        description="Spotted something broken? Report it and follow it to the fix."
        action={report}
      />
      <RecentReports
        title="Your recent reports"
        query="mine=true&pageSize=5"
        emptyTitle="You have not reported anything yet"
        emptyText="Reports you file appear here with their current status."
      />
    </>
  );
}
