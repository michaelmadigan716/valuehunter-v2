import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sitePassword, tokenFor } from "@/app/swing/_lib/auth";

/**
 * Password gate for the Swing Trade Hunter tab ONLY (/swing/*).
 * Set SITE_PASSWORD in Vercel env vars; if unset the tab is open.
 * The rest of the Value Hunter app is never matched and never gated.
 */
export async function proxy(req: NextRequest) {
  const password = sitePassword();
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/swing/login")) return NextResponse.next();

  const expected = await tokenFor(password);
  if (req.cookies.get(COOKIE)?.value === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/swing/login";
  url.search = "";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/swing/:path*"],
};
