import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sitePassword, tokenFor } from "@/app/swing/_lib/auth";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const given = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");
  const expected = sitePassword();

  if (!expected || given !== expected) {
    const url = req.nextUrl.clone();
    url.pathname = "/swing/login";
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }

  const url = req.nextUrl.clone();
  url.pathname = next.startsWith("/swing") ? next : "/swing";
  url.search = "";
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(COOKIE, await tokenFor(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
