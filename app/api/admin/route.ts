import { NextRequest } from "next/server";
import { identityFromRequest, isAdminEmail } from "@/lib/firestore-server";

export const runtime = "nodejs";

/**
 * Am-I-an-admin probe. Any signed-in reviewer may ask; the answer only
 * decides whether the plans page shows the Admin door — the /api/admin data
 * routes re-check the allowlist on every request regardless.
 */
export async function GET(req: NextRequest) {
  const caller = await identityFromRequest(req.headers.get("authorization"));
  if (!caller) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json({ admin: caller.emailVerified && isAdminEmail(caller.email) });
}
