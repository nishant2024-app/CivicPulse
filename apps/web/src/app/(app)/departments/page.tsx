"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Category, Department, Member, Pagination } from "@civicpulse/shared";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";

function DepartmentDialog({
  department,
  onClose,
}: {
  department: Department | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(department?.name ?? "");
  const [description, setDescription] = useState(department?.description ?? "");
  const [managerUserId, setManagerUserId] = useState(department?.manager?.id ?? "");
  const members = useQuery({
    queryKey: ["members", "all"],
    queryFn: () =>
      api.get<{ data: Member[]; pagination: Pagination }>(
        "/organizations/current/members?pageSize=100",
      ),
    select: (response) =>
      response.data.filter(
        (member) => member.status === "ACTIVE" && member.role !== "ORGANIZATION_ADMIN",
      ),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        description: description.trim() || null,
        managerUserId: managerUserId || null,
      };
      return department
        ? api.patch(`/departments/${department.id}`, body)
        : api.post("/departments", body);
    },
    onSuccess: async () => {
      await Promise.all(
        ["departments", "members", "analytics"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      toast.success(department ? "Department updated" : "Department created");
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={department ? "Edit department" : "New department"}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {save.isError ? <Alert>{errorMessage(save.error)}</Alert> : null}
          <Field id="department-name" label="Name">
            <Input
              id="department-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Electrical maintenance"
              autoFocus
            />
          </Field>
          <Field id="department-description" label="What it handles (optional)">
            <Textarea
              id="department-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field
            id="department-manager"
            label="Manager (optional)"
            hint="They become a department manager and can triage this department's reports."
          >
            <Select
              id="department-manager"
              value={managerUserId}
              onChange={(event) => setManagerUserId(event.target.value)}
            >
              <option value="">No manager yet</option>
              {members.data?.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.fullName} ({member.email})
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={save.isPending} disabled={name.trim().length < 2}>
              {department ? "Save" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryRouting({ departments }: { departments: Department[] }) {
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ data: Category[] }>("/organizations/current/categories"),
    select: (response) => response.data,
  });
  const route = useMutation({
    mutationFn: ({ id, defaultDepartmentId }: { id: string; defaultDepartmentId: string | null }) =>
      api.patch(`/organizations/current/categories/${id}`, { defaultDepartmentId }),
    onSuccess: () => {
      toast.success("Routing saved");
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card>
      <CardHeader
        title="Category routing"
        description="New reports in a category go straight to its department's queue."
      />
      {categories.isPending ? (
        <CardBody>
          <Skeleton className="h-40 w-full" />
        </CardBody>
      ) : categories.isError ? (
        <ErrorState
          message={errorMessage(categories.error)}
          onRetry={() => void categories.refetch()}
        />
      ) : (
        <ul className="divide-y divide-line">
          {categories.data.map((category) => (
            <li key={category.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
              <label htmlFor={`route-${category.id}`} className="text-sm font-medium text-ink">
                {category.name}
              </label>
              <Select
                id={`route-${category.id}`}
                className="h-9 max-w-56"
                value={category.defaultDepartmentId ?? ""}
                onChange={(event) =>
                  route.mutate({ id: category.id, defaultDepartmentId: event.target.value || null })
                }
              >
                <option value="">Decide at triage</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function DepartmentsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Department | "new" | null>(null);
  const [removing, setRemoving] = useState<Department | null>(null);
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<{ data: Department[] }>("/departments"),
    select: (response) => response.data,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Department removed");
      setRemoving(null);
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Departments"
        description="The teams that resolve reports. Each has a manager and field workers."
        action={<Button onClick={() => setEditing("new")}>New department</Button>}
      />
      <div className="space-y-6">
        <Card>
          {departments.isPending ? (
            <CardBody className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardBody>
          ) : departments.isError ? (
            <ErrorState
              message={errorMessage(departments.error)}
              onRetry={() => void departments.refetch()}
            />
          ) : departments.data.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No departments yet"
              description="Create the first one — for example “Maintenance” — so reports have somewhere to go."
              action={
                <Button size="sm" onClick={() => setEditing("new")}>
                  New department
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {departments.data.map((department) => (
                <li
                  key={department.id}
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink">{department.name}</p>
                    <p className="text-sm text-muted">
                      {department.description ?? "No description"}
                    </p>
                  </div>
                  <dl className="flex gap-6 text-sm">
                    <div>
                      <dt className="label-mono text-muted">Manager</dt>
                      <dd className="text-ink">{department.manager?.fullName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="label-mono text-muted">Workers</dt>
                      <dd className="font-mono text-ink">{department.workerCount}</dd>
                    </div>
                    <div>
                      <dt className="label-mono text-muted">Open</dt>
                      <dd className="font-mono text-ink">{department.openComplaints}</dd>
                    </div>
                  </dl>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(department)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        remove.reset();
                        setRemoving(department);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {departments.data?.length ? <CategoryRouting departments={departments.data} /> : null}
      </div>

      {editing ? (
        <DepartmentDialog
          department={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {removing ? (
        <Dialog open onOpenChange={(open) => !open && setRemoving(null)}>
          <DialogContent
            title={`Remove ${removing.name}?`}
            description="Its members stay in the organization but lose their department. Past reports keep their history."
          >
            {remove.isError ? <Alert className="mb-4">{errorMessage(remove.error)}</Alert> : null}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate(removing.id)}
              >
                Remove department
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
