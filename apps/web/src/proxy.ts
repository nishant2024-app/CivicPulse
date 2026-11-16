import { NextResponse, type NextRequest } from "next/server";

/**
 * Coarse routing guard based on cookie *presence* only. It avoids flashing the wrong
 * screen; it is not the security boundary — the API validates the session on every call.
 */
const PROTECTED = [
  "/dashboard",
  "/settings",
  "/organizations",
  "/complaints",
  "/report",
  "/notifications",
  "/departments",
  "/members",
  "/audit",
];
const GUEST_ONLY = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("cp_session");
  const matches = (prefixes: string[]) =>
    prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (!hasSession && matches(PROTECTED)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  if (hasSession && matches(GUEST_ONLY)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
