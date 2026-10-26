import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
const digest = (s: string) => createHash("sha256").update(s).digest();
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/api/health" && req.method === "GET")
    return NextResponse.next();
  const password = process.env.DEMO_ACCESS_PASSWORD;
  const hostedDemo =
    process.env.STORAGE_DRIVER === "supabase" &&
    process.env.APP_MODE === "demo";
  if (!password) {
    if (hostedDemo)
      return new NextResponse(
        "Configure DEMO_ACCESS_PASSWORD on the app host before opening this demo.",
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.next();
  }
  const expected = (process.env.DEMO_ACCESS_USER ?? "demo") + ":" + password;
  const authorization = req.headers.get("authorization") ?? "";
  let supplied = "";
  if (authorization.startsWith("Basic ") && authorization.length < 4096) {
    supplied = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  }
  if (!timingSafeEqual(digest(supplied), digest(expected)))
    return new NextResponse("Private Yolda demo", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Yolda demo", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    });
  return NextResponse.next();
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icon.svg|sw.js|offline.html|favicon.ico).*)",
  ],
};
