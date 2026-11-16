"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, Users } from "lucide-react";
import Link from "next/link";
import type { MemberRole, MemberStatus, Organization, Pagination } from "@civicpulse/shared";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { api, errorMessage } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { formatDate, humanize } from "@/lib/utils";

interface Member {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  role: MemberRole;
  departmentId: string | null;
  status: MemberStatus;
  joinedAt: string;
}

function OrganizationCard({ organizationId }: { organizationId: string }) {
  const organization = useQuery({
    queryKey: ["organization", organizationId],
    queryFn: () => api.get<Organization>(`/organizations/${organizationId}`),
  });

  return (
    <Card>
      <CardHeader title="Your organization" />
      {organization.isPending ? (
        <CardBody className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardBody>
      ) : organization.isError ? (
        <ErrorState
          message={errorMessage(organization.error)}
          onRetry={() => void organization.refetch()}
        />
      ) : (
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-ink">{organization.data.name}</h3>
            <Badge tone="brand">{humanize(organization.data.type)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {organization.data.description ?? "No description yet."}
          </p>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Address</dt>
              <dd className="mt-0.5 font-mono text-ink">{organization.data.slug}</dd>
            </div>
            <div>
              <dt className="text-muted">Citizen registration</dt>
              <dd className="mt-0.5 text-ink">
                {organization.data.settings.allowPublicRegistration ? "Open" : "By invitation"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Public tracking</dt>
              <dd className="mt-0.5 text-ink">
                {organization.data.settings.publicTrackingEnabled ? "Enabled" : "Disabled"}
              </dd>
            </div>
          </dl>
        </CardBody>
      )}
    </Card>
  );
}

function MembersCard() {
  const members = useQuery({
    queryKey: ["members", { page: 1 }],
    queryFn: () =>
      api.get<{ data: Member[]; pagination: Pagination }>(
        "/organizations/current/members?page=1&pageSize=10",
      ),
  });

  return (
    <Card>
      <CardHeader
        title="Members"
        description={
          members.data ? `${members.data.pagination.total} in this organization` : undefined
        }
      />
      {members.isPending ? (
        <CardBody className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </CardBody>
      ) : members.isError ? (
        <ErrorState message={errorMessage(members.error)} onRetry={() => void members.refetch()} />
      ) : members.data.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members yet"
          description="People appear here once they register with your organization."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Name
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Role
                </th>
                <th scope="col" className="hidden px-5 py-2.5 font-medium sm:table-cell">
                  Status
                </th>
                <th scope="col" className="hidden px-5 py-2.5 font-medium md:table-cell">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.data.data.map((member) => (
                <tr key={member.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink">{member.fullName}</p>
                    <p className="break-all text-muted">{member.email}</p>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{humanize(member.role)}</td>
                  <td className="hidden px-5 py-3 sm:table-cell">
                    <Badge tone={member.status === "ACTIVE" ? "success" : "neutral"}>
                      {humanize(member.status)}
                    </Badge>
                  </td>
                  <td className="hidden px-5 py-3 text-ink-soft md:table-cell">
                    {formatDate(member.joinedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { data: me } = useMe();
  if (!me) return null;
  const firstName = me.user.fullName.split(" ")[0];

  if (!me.activeOrganizationId) {
    return (
      <>
        <PageHeader title={`Welcome, ${firstName}`} />
        <Card>
          <EmptyState
            icon={Building2}
            title="You are not part of an organization yet"
            description="Create one for your campus, society or community. You will be its administrator and can invite others."
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

  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description={me.role ? `Signed in as ${humanize(me.role).toLowerCase()}.` : undefined}
      />
      <div className="space-y-6">
        <OrganizationCard organizationId={me.activeOrganizationId} />
        {can(me, "member:read") ? <MembersCard /> : null}
      </div>
    </>
  );
}
