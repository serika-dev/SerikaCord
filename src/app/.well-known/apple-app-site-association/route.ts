import { NextResponse } from "next/server";
import { buildAppleAppSiteAssociation } from "@/lib/native/appleAppSiteAssociation";

// Universal links + shared web credentials for the iOS app. Apple fetches
// this through its CDN: it must be JSON, without a redirect, at exactly this
// path (no .json extension).
export function GET() {
  return NextResponse.json(buildAppleAppSiteAssociation(process.env.APPLE_TEAM_ID), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
