"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  MEMBER_ROLES,
  type Department,
  type Member,
  type MemberRole,
  type Pagination,
} from "@civicpulse/shared";
import { PageHeader, Pager } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Alert, Badge, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDate, humanize } from "@/lib/utils";

const ROLE_HELP: Record<MemberRole, string> = {
  CITIZEN: "Reports issues and follows their own reports.",
  FIELD_WORKER: "Works on reports assigned to them.",
  DEPARTMENT_MANAGER: "Triages and assigns reports in one department.",
  ORGANIZATION_ADMIN: "Full control of this organization.",
};

function MemberDialog({
  member,
  departments,
  onClose,
}: {
  member: Member;
  departments: Department[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<MemberRole>(member.role);
  const [departmentId, setDepartmentId] = useState(member.departmentId ?? "");
  const [status, setStatus] = useState(member.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE");
  const needsDepartment = role === "FIELD_WORKER" || role === "DEPARTMENT_MANAGER";
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/organizations/current/members/${member.id}`, {
        role,
        status,
        departmentId: needsDepartment ? departmentId || null : null,
      }),
    onSuccess: async () => {
      await Promise.all(
        ["members", "departments"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
      toast.success(`${member.fullName} updated`);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={member.fullName} description={member.email}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {save.isError ? <Alert>{errorMessage(save.error)}</Alert> : null}
          <Field id="member-role" label="Role" hint={ROLE_HELP[role]}>
            <Select
              id="member-role"
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRole)}
            >
              {MEMBER_ROLES.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </Select>
          </Field>
          {needsDepartment ? (
            <Field
              id="member-department"
              label="Department"
              hint={departments.length === 0 ? "Create a department first." : undefined}
            >
              <Select
                id="member-department"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="" disabled>
                  Select a department
                </option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field
            id="member-status"
            label="Access"
            hint={
              status === "SUSPENDED"
                ? "They cannot open this organization until reactivated."
                : undefined
            }
          >
            <Select
              id="member-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              loading={save.isPending}
              disabled={needsDepartment && !departmentId}
            >
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function MembersPage() {
  const { data: me } = useMe();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Member | null>(null);
  const members = useQuery({
    queryKey: ["members", { page }],
    queryFn: () =>
      api.get<{ data: Member[]; pagination: Pagination }>(
        `/organizations/current/members?page=${page}&pageSize=20`,
      ),
    placeholderData: keepPreviousData,
  });
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<{ data: Department[] }>("/departments"),
    select: (response) => response.data,
  });
  const departmentName = (id: string | null) =>
    departments.data?.find((d) => d.id === id)?.name ?? "—";
  const organization = me?.memberships.find((m) => m.organizationId === me.activeOrganizationId);

  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="People"
        description="Everyone in this organization and what they can do."
      />
      <Alert tone="info" className="mb-6">
        To add someone, ask them to register and choose{" "}
        <strong>{organization?.organizationName}</strong> (address{" "}
        <span className="font-mono">{organization?.organizationSlug}</span>). They join as a
        citizen; change their role here.
      </Alert>
      <Card>
        {members.isPending ? (
          <CardBody className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </CardBody>
        ) : members.isError ? (
          <ErrorState
            message={errorMessage(members.error)}
            onRetry={() => void members.refetch()}
          />
        ) : (
          <>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Name", "Role", "Department", "Joined", ""].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="label-mono px-5 py-2.5 font-medium text-muted"
                      >
                        {heading || <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {members.data.data.map((member) => (
                    <tr key={member.id}>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-ink">
                          {member.fullName}
                          {member.userId === me?.user.id ? (
                            <span className="ml-2 font-normal text-muted">(you)</span>
                          ) : null}
                        </p>
                        <p className="font-mono text-xs text-muted">{member.email}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-ink-soft">{humanize(member.role)}</span>
                        {member.status !== "ACTIVE" ? (
                          <Badge tone="danger" className="ml-2">
                            {humanize(member.status)}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-ink-soft">
                        {departmentName(member.departmentId)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted">
                        {formatDate(member.joinedAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(member)}
                          aria-label={`Edit ${member.fullName}`}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={members.data.pagination.page}
              totalPages={members.data.pagination.totalPages}
              total={members.data.pagination.total}
              onPage={setPage}
            />
          </>
        )}
      </Card>
      {editing ? (
        <MemberDialog
          member={editing}
          departments={departments.data ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
