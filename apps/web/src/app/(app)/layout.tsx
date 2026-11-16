"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const signedOut = me.isSuccess && me.data === null;

  useEffect(() => {
    // The cookie was present but the server no longer accepts it.
    if (signedOut) router.replace("/login");
  }, [signedOut, router]);

  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />
      </div>
    );
  }

  if (!me.data) {
    return (
      <div className="min-h-dvh lg:pl-64" aria-busy="true" aria-label="Loading">
        <div className="fixed inset-y-0 left-0 hidden w-64 bg-navy-900 lg:block" />
        <div className="h-14 border-b border-line bg-surface" />
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return <AppShell me={me.data}>{children}</AppShell>;
}
