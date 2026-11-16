"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  createOrganizationSchema,
  ORGANIZATION_TYPES,
  type CreateOrganizationInput,
  type Organization,
} from "@civicpulse/shared";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { describe, Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { refreshSession } from "@/lib/auth";
import { humanize } from "@/lib/utils";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default function NewOrganizationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "", slug: "", type: "COLLEGE", description: "" },
  });

  const create = useMutation({
    mutationFn: (input: CreateOrganizationInput) =>
      api.post<Organization>("/organizations", {
        ...input,
        description: input.description || undefined,
      }),
    onSuccess: async (organization) => {
      // The creator is now an administrator with a new active organization.
      await refreshSession(queryClient);
      toast.success(`${organization.name} is ready`);
      router.replace("/dashboard");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        form.setError("slug", { message: error.message });
      }
    },
  });

  const { errors, dirtyFields } = form.formState;
  const showBanner = create.isError && !errors.slug;

  return (
    <>
      <PageHeader
        title="Create an organization"
        description="You will be its administrator. Default categories and resolution targets are set up for you and can be changed later."
      />
      <Card className="max-w-2xl">
        <CardBody>
          <form
            className="space-y-4"
            noValidate
            onSubmit={form.handleSubmit((values) => create.mutate(values))}
          >
            {showBanner ? <Alert>{errorMessage(create.error)}</Alert> : null}
            <Field id="name" label="Name" error={errors.name?.message}>
              <Input
                placeholder="Greenfield Engineering College"
                {...describe("name", errors.name?.message)}
                {...form.register("name", {
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    if (!dirtyFields.slug) {
                      form.setValue("slug", slugify(event.target.value), { shouldValidate: false });
                    }
                  },
                })}
              />
            </Field>
            <Field
              id="slug"
              label="Address"
              error={errors.slug?.message}
              hint="Lowercase letters, numbers and hyphens. Citizens pick this when they register."
            >
              <Input
                className="font-mono"
                {...describe("slug", errors.slug?.message, "hint")}
                {...form.register("slug")}
              />
            </Field>
            <Field id="type" label="Type" error={errors.type?.message}>
              <Select {...describe("type", errors.type?.message)} {...form.register("type")}>
                {ORGANIZATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {humanize(type)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="description"
              label="Description (optional)"
              error={errors.description?.message}
            >
              <Textarea
                rows={3}
                {...describe("description", errors.description?.message)}
                {...form.register("description")}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Create organization
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
