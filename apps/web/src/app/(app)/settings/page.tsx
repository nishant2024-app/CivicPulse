"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { passwordSchema, updateProfileSchema, type Me, type SessionInfo } from "@civicpulse/shared";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Alert, Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { describe, Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { ME_KEY, useMe } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(120),
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\+?[0-9 ()-]{7,20}$/.test(value), {
      message: "Enter a valid phone number",
    }),
});
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileCard({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: me.user.fullName, phone: me.user.phone ?? "" },
  });
  const save = useMutation({
    mutationFn: (values: ProfileValues) =>
      api.patch<Me>(
        "/users/me",
        updateProfileSchema.parse({ fullName: values.fullName, phone: values.phone || null }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(ME_KEY, updated);
      form.reset({ fullName: updated.user.fullName, phone: updated.user.phone ?? "" });
      toast.success("Profile saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const { errors, isDirty } = form.formState;

  return (
    <Card>
      <CardHeader title="Profile" description="How you appear to your organization." />
      <CardBody>
        <form
          className="grid max-w-xl gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <Field id="email" label="Email" hint="Your sign-in email cannot be changed here.">
            <Input
              value={me.user.email}
              disabled
              readOnly
              {...describe("email", undefined, "hint")}
            />
          </Field>
          <Field id="fullName" label="Full name" error={errors.fullName?.message}>
            <Input
              autoComplete="name"
              {...describe("fullName", errors.fullName?.message)}
              {...form.register("fullName")}
            />
          </Field>
          <Field id="phone" label="Phone (optional)" error={errors.phone?.message}>
            <Input
              type="tel"
              autoComplete="tel"
              {...describe("phone", errors.phone?.message)}
              {...form.register("phone")}
            />
          </Field>
          <div>
            <Button type="submit" loading={save.isPending} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((values) => values.newPassword === values.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type PasswordValues = z.infer<typeof passwordFormSchema>;

function PasswordCard() {
  const queryClient = useQueryClient();
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: PasswordValues) =>
      api.post("/auth/password/change", { currentPassword, newPassword }),
    onSuccess: () => {
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Password changed. Other devices were signed out.");
    },
  });
  const { errors } = form.formState;

  return (
    <Card>
      <CardHeader
        title="Password"
        description="Changing your password signs you out on every other device."
      />
      <CardBody>
        <form
          className="grid max-w-xl gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => change.mutate(values))}
        >
          {change.isError ? <Alert>{errorMessage(change.error)}</Alert> : null}
          <Field
            id="currentPassword"
            label="Current password"
            error={errors.currentPassword?.message}
          >
            <Input
              type="password"
              autoComplete="current-password"
              {...describe("currentPassword", errors.currentPassword?.message)}
              {...form.register("currentPassword")}
            />
          </Field>
          <Field
            id="newPassword"
            label="New password"
            error={errors.newPassword?.message}
            hint="At least 10 characters."
          >
            <Input
              type="password"
              autoComplete="new-password"
              {...describe("newPassword", errors.newPassword?.message, "hint")}
              {...form.register("newPassword")}
            />
          </Field>
          <Field id="confirm" label="Confirm new password" error={errors.confirm?.message}>
            <Input
              type="password"
              autoComplete="new-password"
              {...describe("confirm", errors.confirm?.message)}
              {...form.register("confirm")}
            />
          </Field>
          <div>
            <Button type="submit" loading={change.isPending}>
              Change password
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** A short, readable label from a user-agent string. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const system = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad/.test(userAgent)
      ? "iOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<{ data: SessionInfo[] }>("/auth/sessions"),
    select: (response) => response.data,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      toast.success("Device signed out");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader
        title="Signed-in devices"
        description="Sign out any device you do not recognize."
      />
      {sessions.isPending ? (
        <CardBody className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardBody>
      ) : sessions.isError ? (
        <ErrorState
          message={errorMessage(sessions.error)}
          onRetry={() => void sessions.refetch()}
        />
      ) : sessions.data.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphone}
          title="No active sessions"
          description="Devices you sign in on will be listed here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {sessions.data.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  {describeDevice(session.userAgent)}
                  {session.current ? <Badge tone="brand">This device</Badge> : null}
                </p>
                <p className="mt-0.5 truncate text-sm text-muted">
                  Last active {formatDateTime(session.lastSeenAt)}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                </p>
              </div>
              {session.current ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  loading={revoke.isPending && revoke.variables === session.id}
                  onClick={() => revoke.mutate(session.id)}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => api.delete("/users/me", { password }),
    onSuccess: () => window.location.assign("/"),
  });

  return (
    <Card className="border-danger-600">
      <CardHeader
        title="Delete account"
        description="Your name, email and phone are erased and you are signed out everywhere. Reports you filed stay with the organization, without your identity."
      />
      <CardBody>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setPassword("");
              remove.reset();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="danger">Delete my account</Button>
          </DialogTrigger>
          <DialogContent
            title="Delete your account?"
            description="This cannot be undone. Enter your password to confirm."
          >
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isError ? <Alert>{errorMessage(remove.error)}</Alert> : null}
              <Field id="delete-password" label="Password">
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button
                  type="submit"
                  variant="danger"
                  loading={remove.isPending}
                  disabled={!password}
                >
                  Delete account
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <>
      <PageHeader title="Settings" description="Your profile, password and devices." />
      <div className="space-y-6">
        <ProfileCard me={me} />
        <PasswordCard />
        <SessionsCard />
        <DeleteAccountCard />
      </div>
    </>
  );
}
