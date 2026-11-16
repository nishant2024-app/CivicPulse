"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { registerSchema, type Me, type PublicOrganization } from "@civicpulse/shared";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { describe, Field, Input, Select } from "@/components/ui/form";
import { api, ApiError, errorMessage } from "@/lib/api";
import { ME_KEY } from "@/lib/auth";
import { humanize } from "@/lib/utils";

/** Value of the organization select meaning "I will create my own". */
const OWN_ORGANIZATION = "__own__";

const formSchema = registerSchema
  .omit({ organizationSlug: true })
  .extend({ organization: z.string().min(1, "Choose your community") });
type FormValues = z.infer<typeof formSchema>;

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const wantsOwnOrganization = params.get("intent") === "organization";

  const organizations = useQuery({
    queryKey: ["organizations", "public"],
    queryFn: () => api.get<{ data: PublicOrganization[] }>("/organizations/public"),
    select: (response) => response.data,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      organization: wantsOwnOrganization ? OWN_ORGANIZATION : "",
    },
  });

  const register = useMutation({
    mutationFn: ({ organization, ...account }: FormValues) =>
      api.post<Me>("/auth/register", {
        ...account,
        ...(organization === OWN_ORGANIZATION ? {} : { organizationSlug: organization }),
      }),
    onSuccess: (me) => {
      queryClient.setQueryData(ME_KEY, me);
      router.replace(me.activeOrganizationId ? "/dashboard" : "/organizations/new");
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const field of ["fullName", "email", "password"] as const) {
          const message = error.fieldError(field);
          if (message) form.setError(field, { message });
        }
        if (error.code === "CONFLICT") form.setError("email", { message: error.message });
      }
    },
  });

  const { errors } = form.formState;
  const showBanner = register.isError && !Object.keys(errors).length;

  return (
    <>
      <h1 className="text-[26px] font-extrabold text-ink">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>

      {showBanner ? <Alert className="mt-6">{errorMessage(register.error)}</Alert> : null}

      <form
        className="mt-6 space-y-4"
        noValidate
        onSubmit={form.handleSubmit((values) => register.mutate(values))}
      >
        <Field id="fullName" label="Full name" error={errors.fullName?.message}>
          <Input
            autoComplete="name"
            {...describe("fullName", errors.fullName?.message)}
            {...form.register("fullName")}
          />
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            {...describe("email", errors.email?.message)}
            {...form.register("email")}
          />
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password?.message}
          hint="At least 10 characters. A short sentence works well."
        >
          <Input
            type="password"
            autoComplete="new-password"
            {...describe("password", errors.password?.message, "hint")}
            {...form.register("password")}
          />
        </Field>
        <Field
          id="organization"
          label="Your community"
          error={
            errors.organization?.message ??
            (organizations.isError ? "Could not load communities. Reload to try again." : undefined)
          }
          hint="Reports you file go to this organization."
        >
          <Select
            disabled={organizations.isPending}
            {...describe("organization", errors.organization?.message, "hint")}
            {...form.register("organization")}
          >
            <option value="" disabled>
              {organizations.isPending ? "Loading…" : "Select a community"}
            </option>
            {organizations.data?.map((organization) => (
              <option key={organization.id} value={organization.slug}>
                {organization.name} — {humanize(organization.type)}
              </option>
            ))}
            <option value={OWN_ORGANIZATION}>I am setting up a new organization</option>
          </Select>
        </Field>
        <Button type="submit" className="w-full" loading={register.isPending}>
          Create account
        </Button>
      </form>
    </>
  );
}
