"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Lock, MapPin, Star } from "lucide-react";
import Link from "next/link";
import { use, useRef, useState } from "react";
import { toast } from "sonner";
import {
  COMPLAINT_PRIORITIES,
  type ComplaintDetail,
  type ComplaintStatus,
  type Department,
} from "@civicpulse/shared";
import {
  DueFlag,
  PriorityTag,
  STATUS_ACTION,
  StatusTag,
  Timeline,
  TrackingId,
} from "@/components/complaints";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Alert, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Field, Select, Textarea } from "@/components/ui/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn, formatDateTime, fromNow, humanize } from "@/lib/utils";

type Run = (request: Promise<unknown>, success: string) => Promise<boolean>;

function StatusDialog({
  target,
  requiresNote,
  onClose,
  onConfirm,
}: {
  target: ComplaintStatus;
  requiresNote: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const prompts: Partial<Record<ComplaintStatus, string>> = {
    REJECTED: "Why is this report being rejected? The reporter will see this.",
    RESOLVED: "What was done? The reporter and the public tracking page will show this.",
    ON_HOLD: "What is the work waiting for?",
    REOPENED: "What is still wrong?",
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`${STATUS_ACTION[target]}?`} description={prompts[target]}>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const done = await onConfirm(note);
            setBusy(false);
            if (done) onClose();
          }}
        >
          <Field id="status-note" label={requiresNote ? "Note" : "Note (optional)"}>
            <Textarea
              id="status-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              variant={target === "REJECTED" ? "danger" : "primary"}
              loading={busy}
              disabled={requiresNote && !note.trim()}
            >
              {STATUS_ACTION[target]}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  complaint,
  onClose,
  run,
}: {
  complaint: ComplaintDetail;
  onClose: () => void;
  run: Run;
}) {
  const [departmentId, setDepartmentId] = useState(complaint.department?.id ?? "");
  const [workerId, setWorkerId] = useState(complaint.assignedWorker?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<{ data: Department[] }>("/departments"),
    select: (response) => response.data.filter((department) => department.isActive),
  });
  const workers = useQuery({
    queryKey: ["departments", departmentId, "workers"],
    queryFn: () =>
      api.get<{ data: Array<{ userId: string; fullName: string; activeAssignments: number }> }>(
        `/departments/${departmentId}/workers`,
      ),
    select: (response) => response.data,
    enabled: !!departmentId,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Assign this report"
        description="Pick the department. Naming a worker is optional."
      >
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const done = await run(
              api.post(`/complaints/${complaint.id}/assign`, {
                departmentId,
                workerId: workerId || null,
                ...(note.trim() ? { note } : {}),
              }),
              "Report assigned",
            );
            setBusy(false);
            if (done) onClose();
          }}
        >
          {departments.data?.length === 0 ? (
            <Alert tone="info">
              There are no departments yet.{" "}
              <Link href="/departments" className="font-semibold underline">
                Create one
              </Link>{" "}
              first.
            </Alert>
          ) : null}
          <Field id="assign-department" label="Department">
            <Select
              id="assign-department"
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setWorkerId("");
              }}
            >
              <option value="" disabled>
                {departments.isPending ? "Loading…" : "Select a department"}
              </option>
              {departments.data?.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name} — {department.openComplaints} open
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="assign-worker"
            label="Field worker (optional)"
            hint={
              departmentId && workers.data?.length === 0
                ? "This department has no field workers yet."
                : undefined
            }
          >
            <Select
              id="assign-worker"
              value={workerId}
              disabled={!departmentId}
              onChange={(event) => setWorkerId(event.target.value)}
            >
              <option value="">Leave for the department to decide</option>
              {workers.data?.map((worker) => (
                <option key={worker.userId} value={worker.userId}>
                  {worker.fullName} — {worker.activeAssignments} active
                </option>
              ))}
            </Select>
          </Field>
          <Field id="assign-note" label="Instructions (optional)" hint="Visible to staff only.">
            <Textarea
              id="assign-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy} disabled={!departmentId}>
              Assign
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Feedback({ complaint, run }: { complaint: ComplaintDetail; run: Run }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  if (complaint.feedback) {
    return (
      <Card>
        <CardHeader title={complaint.isReporter ? "Your rating" : "Reporter\u2019s rating"} />
        <CardBody>
          <p className="flex gap-0.5" aria-label={`${complaint.feedback.rating} out of 5`}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={cn(
                  "size-5",
                  star <= complaint.feedback!.rating
                    ? "fill-signal text-signal"
                    : "text-line-strong",
                )}
                aria-hidden
              />
            ))}
          </p>
          {complaint.feedback.comment ? (
            <p className="mt-2 text-sm text-ink-soft">{complaint.feedback.comment}</p>
          ) : null}
        </CardBody>
      </Card>
    );
  }
  if (!complaint.actions.canGiveFeedback) return null;
  return (
    <Card>
      <CardHeader title="How was it handled?" description="Your rating goes to the organization." />
      <CardBody>
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            await run(
              api.post(`/complaints/${complaint.id}/feedback`, {
                rating,
                ...(comment.trim() ? { comment } : {}),
              }),
              "Thanks for the feedback",
            );
            setBusy(false);
          }}
        >
          <fieldset>
            <legend className="sr-only">Rating</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <label
                  key={star}
                  className="cursor-pointer p-0.5 has-focus-visible:outline-2 has-focus-visible:outline-brand-600"
                >
                  <input
                    type="radio"
                    name="rating"
                    value={star}
                    className="sr-only"
                    checked={rating === star}
                    onChange={() => setRating(star)}
                  />
                  <Star
                    className={cn(
                      "size-7",
                      star <= rating ? "fill-signal text-signal" : "text-line-strong",
                    )}
                    aria-hidden
                  />
                  <span className="sr-only">
                    {star} star{star > 1 ? "s" : ""}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Textarea
            aria-label="Comment (optional)"
            placeholder="Anything to add? (optional)"
            rows={2}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button type="submit" loading={busy} disabled={rating === 0}>
            Send rating
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export default function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const key = ["complaints", "detail", id];
  const complaint = useQuery({
    queryKey: key,
    queryFn: () => api.get<ComplaintDetail>(`/complaints/${id}`),
  });
  const [statusTarget, setStatusTarget] = useState<{
    to: ComplaintStatus;
    requiresNote: boolean;
  } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Run an action, refresh everything that depends on this complaint, report the outcome. */
  const run: Run = async (request, success) => {
    try {
      await request;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["complaints"] }),
        queryClient.invalidateQueries({ queryKey: ["analytics"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };

  const comment = useMutation({
    mutationFn: () =>
      run(
        api.post(`/complaints/${id}/comments`, { body: reply, isInternal: internal }),
        internal ? "Internal note added" : "Reply posted",
      ),
    onSuccess: (done) => done && setReply(""),
  });
  const upload = useMutation({
    mutationFn: (file: File) =>
      run(api.upload(`/complaints/${id}/attachments`, file), "Photo added"),
  });

  if (complaint.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (complaint.isError) {
    const missing = complaint.error instanceof ApiError && complaint.error.status === 404;
    return (
      <Card>
        <ErrorState
          message={
            missing
              ? "This report does not exist, or you do not have access to it."
              : errorMessage(complaint.error)
          }
          onRetry={missing ? undefined : () => void complaint.refetch()}
        />
      </Card>
    );
  }

  const c = complaint.data;
  const { actions } = c;
  const hasActions =
    actions.transitions.length > 0 || actions.canAssign || actions.canAcceptAssignment;

  return (
    <>
      <Link
        href="/complaints"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden /> All reports
      </Link>

      <header className="mb-6 border-b-2 border-ink pb-5">
        <div className="flex flex-wrap items-center gap-3">
          <TrackingId id={c.trackingId} />
          <StatusTag status={c.status} />
          <PriorityTag priority={c.priority} />
          <DueFlag slaDueAt={c.slaDueAt} isOverdue={c.isOverdue} status={c.status} />
        </div>
        <h1 className="mt-3 text-[26px] leading-tight font-extrabold text-ink">{c.title}</h1>
        <p className="mt-1.5 text-sm text-muted">
          {c.category.name} · reported {fromNow(c.createdAt)} by{" "}
          {c.isReporter ? "you" : c.reporter.fullName}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {hasActions ? (
            <section
              aria-label="Actions"
              className="flex flex-wrap items-center gap-2 border-l-4 border-signal bg-surface px-4 py-3"
            >
              <p className="label-mono mr-2 text-muted">Next step</p>
              {actions.canAcceptAssignment ? (
                <Button
                  onClick={() =>
                    void run(api.post(`/complaints/${id}/assignment/accept`), "Assignment accepted")
                  }
                >
                  Accept assignment
                </Button>
              ) : null}
              {actions.transitions.map((transition) => (
                <Button
                  key={transition.to}
                  variant={
                    transition.to === "REJECTED"
                      ? "outline"
                      : transition.to === "REOPENED" || transition.to === "ON_HOLD"
                        ? "outline"
                        : "primary"
                  }
                  onClick={() =>
                    transition.requiresNote
                      ? setStatusTarget(transition)
                      : void run(
                          api.post(`/complaints/${id}/status`, { status: transition.to }),
                          `${STATUS_ACTION[transition.to]}: done`,
                        )
                  }
                >
                  {STATUS_ACTION[transition.to]}
                </Button>
              ))}
              {actions.canAssign ? (
                <Button
                  variant={
                    c.status === "VERIFIED" || c.status === "REOPENED" ? "primary" : "outline"
                  }
                  onClick={() => setAssigning(true)}
                >
                  {c.assignedWorker || c.status === "ASSIGNED" ? "Reassign" : "Assign"}
                </Button>
              ) : null}
            </section>
          ) : null}

          <Card>
            <CardHeader title="What was reported" />
            <CardBody>
              <p className="whitespace-pre-wrap text-ink">{c.description}</p>
              <p className="mt-4 flex items-start gap-2 text-sm text-ink-soft">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {c.locationText}
                  {c.latitude !== null && c.longitude !== null ? (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=18/${c.latitude}/${c.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 font-mono text-xs text-brand-600 hover:underline"
                    >
                      {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)} ↗
                    </a>
                  ) : null}
                </span>
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Photos"
              action={
                actions.canUpload ? (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      aria-label="Add a photo"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) upload.mutate(file);
                        event.target.value = "";
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      loading={upload.isPending}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Camera aria-hidden /> Add photo
                    </Button>
                  </>
                ) : null
              }
            />
            <CardBody>
              {c.attachments.length === 0 ? (
                <p className="text-sm text-muted">No photos were added.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {c.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group block border border-line-strong"
                      >
                        <img
                          src={attachment.thumbnailUrl}
                          alt={`${humanize(attachment.kind)} photo`}
                          className="aspect-square w-full object-cover group-hover:opacity-90"
                          loading="lazy"
                        />
                      </a>
                      <p className="label-mono mt-1 text-muted">
                        {attachment.kind === "REPORT"
                          ? "From the reporter"
                          : attachment.kind === "RESOLUTION"
                            ? "Work evidence"
                            : "Added by staff"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Conversation" />
            <CardBody className="space-y-4">
              {c.comments.length === 0 ? (
                <p className="text-sm text-muted">No replies yet.</p>
              ) : null}
              {c.comments.map((entry) => (
                <article
                  key={entry.id}
                  className={cn(
                    "border-l-2 pl-3",
                    entry.isInternal
                      ? "border-signal bg-signal-soft/50 py-2 pr-2"
                      : "border-line-strong",
                  )}
                >
                  <p className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-semibold text-ink">
                      {entry.author?.fullName ?? "Former member"}
                    </span>
                    {entry.authorIsStaff ? (
                      <span className="label-mono text-muted">Staff</span>
                    ) : null}
                    {entry.isInternal ? (
                      <span className="label-mono inline-flex items-center gap-1 text-warning-700">
                        <Lock className="size-3" aria-hidden /> Internal
                      </span>
                    ) : null}
                    <time className="font-mono text-xs text-muted" dateTime={entry.createdAt}>
                      {formatDateTime(entry.createdAt)}
                    </time>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{entry.body}</p>
                </article>
              ))}
              <form
                className="space-y-2 border-t border-line pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  comment.mutate();
                }}
              >
                <Textarea
                  aria-label={internal ? "Internal note" : "Reply"}
                  placeholder={internal ? "Note for staff only…" : "Write a reply…"}
                  rows={2}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {actions.canCommentInternally ? (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
                      <input
                        type="checkbox"
                        className="size-4 accent-navy-900"
                        checked={internal}
                        onChange={(event) => setInternal(event.target.checked)}
                      />
                      Internal note — hidden from the reporter
                    </label>
                  ) : (
                    <span />
                  )}
                  <Button
                    type="submit"
                    size="sm"
                    loading={comment.isPending}
                    disabled={!reply.trim()}
                  >
                    {internal ? "Add note" : "Send reply"}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          <Feedback complaint={c} run={run} />
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Progress" />
            <CardBody>
              <Timeline
                entries={c.history.map((entry) => ({
                  key: entry.id,
                  status: entry.toStatus,
                  note: entry.note,
                  at: entry.createdAt,
                  by: entry.changedBy?.fullName,
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Handling" />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="label-mono text-muted">Department</dt>
                  <dd className="mt-0.5 text-ink">{c.department?.name ?? "Not routed yet"}</dd>
                </div>
                <div>
                  <dt className="label-mono text-muted">Assigned to</dt>
                  <dd className="mt-0.5 text-ink">
                    {c.assignedWorker?.fullName ?? "Nobody yet"}
                    {c.assignment ? (
                      <span className="ml-2 font-mono text-xs text-muted">
                        {c.assignment.status === "ACCEPTED" ? "accepted" : "awaiting acceptance"}
                      </span>
                    ) : null}
                  </dd>
                </div>
                {c.assignment?.note ? (
                  <div>
                    <dt className="label-mono text-muted">Instructions</dt>
                    <dd className="mt-0.5 text-ink-soft">{c.assignment.note}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="label-mono text-muted">Priority</dt>
                  <dd className="mt-1">
                    {actions.canEditTriage ? (
                      <Select
                        aria-label="Priority"
                        className="h-9"
                        value={c.priority}
                        onChange={(event) =>
                          void run(
                            api.patch(`/complaints/${id}`, { priority: event.target.value }),
                            "Priority updated",
                          )
                        }
                      >
                        {COMPLAINT_PRIORITIES.map((priority) => (
                          <option key={priority} value={priority}>
                            {humanize(priority)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <PriorityTag priority={c.priority} />
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="label-mono text-muted">Public tracking</dt>
                  <dd className="mt-0.5">
                    <Link
                      href={`/track/${c.trackingId}`}
                      className="text-brand-600 hover:underline"
                    >
                      Open the public page ↗
                    </Link>
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </aside>
      </div>

      {statusTarget ? (
        <StatusDialog
          target={statusTarget.to}
          requiresNote={statusTarget.requiresNote}
          onClose={() => setStatusTarget(null)}
          onConfirm={(note) =>
            run(
              api.post(`/complaints/${id}/status`, {
                status: statusTarget.to,
                ...(note.trim() ? { note } : {}),
              }),
              `${STATUS_ACTION[statusTarget.to]}: done`,
            )
          }
        />
      ) : null}
      {assigning ? (
        <AssignDialog complaint={c} onClose={() => setAssigning(false)} run={run} />
      ) : null}
    </>
  );
}
