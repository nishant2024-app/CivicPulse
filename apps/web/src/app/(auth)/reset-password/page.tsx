"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { passwordSchema } from "@civicpulse/shared";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { describe, Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type Values = z.infer<typeof schema>;

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });
  const reset = useMutation({
    mutationFn: (values: Values) =>
      api.post("/auth/password/reset", { token, password: values.password }),
    onSuccess: () => router.replace("/login?reset=1"),
  });
  const { errors } = form.formState;

  if (!token) {
    return (
      <Alert className="mt-6">
        This link is incomplete.{" "}
        <Link href="/forgot-password" className="font-medium underline">
          Request a new one
        </Link>
        .
      </Alert>
    );
  }

  return (
    <form
      className="mt-6 space-y-4"
      noValidate
      onSubmit={form.handleSubmit((values) => reset.mutate(values))}
    >
      {reset.isError ? <Alert>{errorMessage(reset.error)}</Alert> : null}
      <Field
        id="password"
        label="New password"
        error={errors.password?.message}
        hint="At least 10 characters."
      >
        <Input
          type="password"
          autoComplete="new-password"
          {...describe("password", errors.password?.message, "hint")}
          {...form.register("password")}
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
      <Button type="submit" className="w-full" loading={reset.isPending}>
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-[26px] font-extrabold text-ink">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted">
        You will be signed out everywhere and can sign in again with the new password.
      </p>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
