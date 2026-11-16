"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  COMPLAINT_PRIORITIES,
  type Category,
  type ComplaintDetail,
  type Organization,
} from "@civicpulse/shared";
import { PageHeader } from "@/components/app-shell";
import { TrackingId } from "@/components/complaints";
import { LocationPicker, type Coordinates } from "@/components/location-picker";
import { Button } from "@/components/ui/button";
import { Alert, ErrorState, Skeleton } from "@/components/ui/feedback";
import { describe, Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn, humanize } from "@/lib/utils";

const MAX_PHOTOS = 4;
const MAX_BYTES = 8 * 1024 * 1024;

const schema = z.object({
  categoryId: z.string().min(1, "Choose what kind of problem this is"),
  title: z.string().trim().min(5, "Give the problem a short title").max(140),
  description: z.string().trim().min(10, "Describe what is wrong").max(4000),
  locationText: z.string().trim().min(3, "Say where it is").max(240),
  priority: z.enum(COMPLAINT_PRIORITIES),
});
type Values = z.infer<typeof schema>;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-6 first:border-t-0 first:pt-0 md:grid-cols-[11rem_1fr]">
      <div>
        <p className="font-mono text-xs text-muted">STEP {n} OF 4</p>
        <h2 className="mt-1 text-lg font-bold text-ink">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function ReportPage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [done, setDone] = useState<{ complaint: ComplaintDetail; failedPhotos: number } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ data: Category[] }>("/organizations/current/categories"),
    select: (response) => response.data.filter((category) => category.isActive),
  });
  const organization = useQuery({
    queryKey: ["organization", me?.activeOrganizationId],
    queryFn: () => api.get<Organization>(`/organizations/${me!.activeOrganizationId}`),
    enabled: !!me?.activeOrganizationId,
  });
  const maySetPriority =
    me?.role !== "CITIZEN" || organization.data?.settings.citizenCanSetPriority;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      categoryId: "",
      title: "",
      description: "",
      locationText: "",
      priority: "MEDIUM",
    },
  });
  const { errors } = form.formState;
  const selectedCategory = form.watch("categoryId");

  const previews = useMemo(() => photos.map((file) => URL.createObjectURL(file)), [photos]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    setPhotoError(null);
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setPhotoError("Photos must be JPEG, PNG or WebP.");
      } else if (file.size > MAX_BYTES) {
        setPhotoError("Each photo can be up to 8 MB.");
      } else accepted.push(file);
    }
    setPhotos((current) => {
      const next = [...current, ...accepted];
      if (next.length > MAX_PHOTOS) setPhotoError(`You can attach up to ${MAX_PHOTOS} photos.`);
      return next.slice(0, MAX_PHOTOS);
    });
    if (fileInput.current) fileInput.current.value = "";
  }

  const submit = useMutation({
    mutationFn: async (values: Values) => {
      const complaint = await api.post<ComplaintDetail>("/complaints", {
        categoryId: values.categoryId,
        title: values.title,
        description: values.description,
        locationText: values.locationText,
        ...(coordinates ?? {}),
        ...(maySetPriority ? { priority: values.priority } : {}),
      });
      // The report is saved at this point. A photo that fails must not lose it.
      const results = await Promise.allSettled(
        photos.map((file) => api.upload(`/complaints/${complaint.id}/attachments`, file)),
      );
      return { complaint, failedPhotos: results.filter((r) => r.status === "rejected").length };
    },
    onSuccess: (result) => {
      setDone(result);
      void queryClient.invalidateQueries({ queryKey: ["complaints"] });
      window.scrollTo({ top: 0 });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (done) {
    return (
      <div className="mx-auto max-w-xl border-2 border-ink bg-surface">
        <div className="hazard h-2" aria-hidden />
        <div className="p-8 text-center">
          <CheckCircle2 className="mx-auto size-9 text-success-700" aria-hidden />
          <h1 className="mt-4 text-2xl font-extrabold text-ink">Report received</h1>
          <p className="mt-2 text-sm text-muted">
            Keep this tracking ID. Anyone with it can follow the progress.
          </p>
          <div className="mt-5">
            <TrackingId id={done.complaint.trackingId} size="lg" />
          </div>
          {done.failedPhotos > 0 ? (
            <Alert className="mt-5 text-left">
              {done.failedPhotos} photo{done.failedPhotos > 1 ? "s" : ""} could not be uploaded. The
              report itself is saved — you can add photos from its page.
            </Alert>
          ) : null}
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href={`/complaints/${done.complaint.id}`}>Open the report</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDone(null);
                setPhotos([]);
                setCoordinates(null);
                form.reset();
              }}
            >
              Report another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="New report"
        title="Report an issue"
        description="Four short steps. The clearer the location, the faster someone can get to it."
      />
      <form
        className="border border-line bg-surface p-5 sm:p-7"
        noValidate
        onSubmit={form.handleSubmit((values) => submit.mutate(values))}
      >
        <Step n={1} title="What kind of problem?">
          {categories.isPending ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 9 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : categories.isError ? (
            <ErrorState
              message={errorMessage(categories.error)}
              onRetry={() => void categories.refetch()}
            />
          ) : (
            <fieldset>
              <legend className="sr-only">Category</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {categories.data.map((category) => (
                  <label
                    key={category.id}
                    className={cn(
                      "flex cursor-pointer items-center border px-3 py-2.5 text-sm font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-brand-600",
                      selectedCategory === category.id
                        ? "border-navy-900 bg-navy-900 text-white"
                        : "border-line-strong text-ink hover:border-ink",
                    )}
                  >
                    <input
                      type="radio"
                      value={category.id}
                      className="sr-only"
                      {...form.register("categoryId")}
                    />
                    {category.name}
                  </label>
                ))}
              </div>
              {errors.categoryId ? (
                <p role="alert" className="mt-2 text-sm text-danger-700">
                  {errors.categoryId.message}
                </p>
              ) : null}
            </fieldset>
          )}
        </Step>

        <Step n={2} title="What is wrong?">
          <Field id="title" label="Short title" error={errors.title?.message}>
            <Input
              placeholder="Streetlight out near the library gate"
              {...describe("title", errors.title?.message)}
              {...form.register("title")}
            />
          </Field>
          <Field
            id="description"
            label="Details"
            error={errors.description?.message}
            hint="How long has it been like this? Is anyone at risk?"
          >
            <Textarea
              rows={4}
              {...describe("description", errors.description?.message, "hint")}
              {...form.register("description")}
            />
          </Field>
          {maySetPriority ? (
            <Field id="priority" label="How urgent is it?">
              <Select id="priority" className="max-w-xs" {...form.register("priority")}>
                {COMPLAINT_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {humanize(priority)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </Step>

        <Step n={3} title="Where is it?">
          <Field
            id="locationText"
            label="Location in words"
            error={errors.locationText?.message}
            hint="A landmark someone unfamiliar could find: “Block C, second-floor corridor”."
          >
            <Input
              {...describe("locationText", errors.locationText?.message, "hint")}
              {...form.register("locationText")}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink">Pin on the map (optional)</p>
            <LocationPicker value={coordinates} onChange={setCoordinates} />
          </div>
        </Step>

        <Step n={4} title="Add photos">
          <p className="text-sm text-muted">
            Optional, up to {MAX_PHOTOS}. Location data inside the photo file is removed before it
            is stored.
          </p>
          <div className="flex flex-wrap gap-3">
            {photos.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="relative size-24 border border-line-strong"
              >
                <img
                  src={previews[index]}
                  alt={`Photo ${index + 1}: ${file.name}`}
                  className="size-full object-cover"
                />
                <button
                  type="button"
                  className="absolute -top-2 -right-2 bg-ink p-1 text-white hover:bg-danger-600"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <label className="flex size-24 cursor-pointer flex-col items-center justify-center gap-1 border border-dashed border-line-strong text-sm text-ink-soft hover:border-ink hover:text-ink has-focus-visible:outline-2 has-focus-visible:outline-brand-600">
                <Camera className="size-5" aria-hidden />
                Add photo
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  onChange={(event) => addPhotos(event.target.files)}
                />
              </label>
            ) : null}
          </div>
          {photoError ? (
            <p role="alert" className="text-sm text-danger-700">
              {photoError}
            </p>
          ) : null}
        </Step>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t-2 border-ink pt-5">
          <Button asChild variant="ghost">
            <Link href="/complaints">Cancel</Link>
          </Button>
          <Button type="submit" size="lg" loading={submit.isPending}>
            Submit report
          </Button>
        </div>
      </form>
    </>
  );
}
