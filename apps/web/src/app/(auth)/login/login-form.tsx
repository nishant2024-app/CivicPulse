"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { loginSchema, type LoginInput, type Me } from "@civicpulse/shared";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { describe, Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { ME_KEY } from "@/lib/auth";

/** Only follow same-site relative paths; never an attacker-supplied absolute URL. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const login = useMutation({
    mutationFn: (input: LoginInput) => api.post<Me>("/auth/login", input),
    onSuccess: (me) => {
      queryClient.setQueryData(ME_KEY, me);
      router.replace(safeNext(params.get("next")));
    },
  });

  const { errors } = form.formState;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1.5 text-sm text-muted">
        New here?{" "}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>

      {params.get("reset") === "1" ? (
        <Alert tone="success" className="mt-6">
          Password updated. Sign in with your new password.
        </Alert>
      ) : null}
      {login.isError ? <Alert className="mt-6">{errorMessage(login.error)}</Alert> : null}

      <form
        className="mt-6 space-y-4"
        noValidate
        onSubmit={form.handleSubmit((values) => login.mutate(values))}
      >
        <Field id="email" label="Email" error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            {...describe("email", errors.email?.message)}
            {...form.register("email")}
          />
        </Field>
        <Field id="password" label="Password" error={errors.password?.message}>
          <Input
            type="password"
            autoComplete="current-password"
            {...describe("password", errors.password?.message)}
            {...form.register("password")}
          />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </>
  );
}
