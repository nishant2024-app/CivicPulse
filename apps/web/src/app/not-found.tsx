import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo />
      <p className="mt-10 font-mono text-sm text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">This page does not exist</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        The link may be out of date, or the page may have moved.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
