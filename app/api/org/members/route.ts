import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { errorToResponse, requireOrgContext } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";

export const runtime = "nodejs";
const MEMBERS_LIST_LIMIT_PER_10_MIN = 120;
const MEMBERS_LIST_IP_LIMIT_PER_10_MIN = 300;

type MemberRow = {
  uid: string;
  email: string | null;
  name: string | null;
  position: string | null;
  role: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
};

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const dt = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const { orgId, uid } = await requireOrgContext(req);

    await enforceRateLimit({
      scope: "org_members_list_user",
      key: `${orgId}:${uid}`,
      limit: MEMBERS_LIST_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    await enforceRateLimit({
      scope: "org_members_list_ip",
      key: getRequestIp(req),
      limit: MEMBERS_LIST_IP_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 200;

    const membersSnap = await adminDb
      .collection("organizations")
      .doc(orgId)
      .collection("members")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const members: MemberRow[] = membersSnap.docs.map((d) => {
      const m = d.data() as Record<string, unknown>;
      return {
        uid: d.id,
        email: asString(m.email),
        name: asString(m.name),
        position: asString(m.position),
        role: asString(m.role) ?? "member",
        status: asString(m.status) ?? "active",
        createdAt: toIsoDate(m.createdAt),
        updatedAt: toIsoDate(m.updatedAt),
      };
    });

    return NextResponse.json({ ok: true, members });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }

    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
