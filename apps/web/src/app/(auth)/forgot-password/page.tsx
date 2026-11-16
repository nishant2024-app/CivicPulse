"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { forgotPasswordSchema } from "@civicpulse/shared";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { describe, Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";

type Values = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const form = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const request = useMutation({
    mutationFn: (values: Values) => api.post("/auth/password/forgot", values),
  });
  const error = form.formState.errors.email?.message;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted">
        Enter your email and we will send a link to choose a new password.
      </p>

      {request.isSuccess ? (
        <Alert tone="success" className="mt-6">
          If an account exists for that email, a reset link is on its way. The link works once and
          expires in an hour.
        </Alert>
      ) : (
        <form
          className="mt-6 space-y-4"
          noValidate
          onSubmit={form.handleSubmit((values) => request.mutate(values))}
        >
          {request.isError ? <Alert>{errorMessage(request.error)}</Alert> : null}
          <Field id="email" label="Email" error={error}>
            <Input
              type="email"
              autoComplete="email"
              {...describe("email", error)}
              {...form.register("email")}
            />
          </Field>
          <Button type="submit" className="w-full" loading={request.isPending}>
            Send reset link
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm">
        <Link href="/login" className="text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
