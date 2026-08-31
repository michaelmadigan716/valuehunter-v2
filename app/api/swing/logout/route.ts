import { NextResponse, type NextRequest } from "next/server";
import { COOKIE } from "@/app/swing/_lib/auth";

export async function POST(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/swing/login";
  url.search = "";
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
