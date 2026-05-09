// app/api/create-org/route.ts
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";
const MAX_WORKPLACES = 100;
const CREATE_ORG_LIMIT_PER_10_MIN = 25;
const CREATE_ORG_IP_LIMIT_PER_10_MIN = 50;

function activeTesterAccessCode() {
  const fromEnv = String(process.env.TESTER_ACCESS_CODE ?? "").trim();
  return fromEnv.length > 0 ? fromEnv : null;
}

function isValidHttpUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseOptionalString(v: unknown) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function isValidYearStr(y: string) {
  if (!/^\d{4}$/.test(y)) return false;
  const year = Number(y);
  const now = new Date().getFullYear();
  return year >= 1600 && year <= now;
}

export async function POST(req: Request) {
  try {
    // 1) Auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
    }
    const idToken = authHeader.slice("Bearer ".length).trim();
    if (!idToken) {
      return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
    }

    // 2) Verify token
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email ?? null;

    await enforceRateLimit({
      scope: "create_org_user",
      key: uid,
      limit: CREATE_ORG_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "create_org_ip",
      key: getRequestIp(req),
      limit: CREATE_ORG_IP_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });

    // 3) Parse body
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orgName = String(body?.orgName ?? "").trim();
    const testerAccessCode = String(body?.testerAccessCode ?? "").trim();
    const mission = parseOptionalString(body?.mission);
    const homeState = parseOptionalString(body?.homeState);
    const taxStatus = parseOptionalString(body?.taxStatus);
    const fiscalYear = parseOptionalString(body?.fiscalYear);
    const crm = parseOptionalString(body?.crm);
    const address = parseOptionalString(body?.address);
    const foundedYearRaw = parseOptionalString(body?.foundedYear);
    const foundedYear =
      foundedYearRaw && isValidYearStr(foundedYearRaw)
        ? Number(foundedYearRaw)
        : null;

    const numEmployeesRaw = body?.numEmployees;
    const numEmployees =
      typeof numEmployeesRaw === "number" &&
      Number.isFinite(numEmployeesRaw) &&
      numEmployeesRaw >= 0
        ? Math.floor(numEmployeesRaw)
        : numEmployeesRaw == null
        ? null
        : NaN;

    const websiteUrlRaw = parseOptionalString(body?.websiteUrl) ?? "";
    const websiteConsent = Boolean(body?.websiteConsent);

    // 4) Validate required fields
    if (!testerAccessCode) {
      return NextResponse.json(
        { error: "Tester access code is required to create a workplace." },
        { status: 400 }
      );
    }
    const configuredTesterAccessCode = activeTesterAccessCode();
    if (!configuredTesterAccessCode) {
      return NextResponse.json(
        { error: "Tester access is not configured on this environment." },
        { status: 503 }
      );
    }
    if (testerAccessCode !== configuredTesterAccessCode) {
      return NextResponse.json(
        { error: "Invalid tester access code." },
        { status: 403 }
      );
    }
    if (!orgName) {
      return NextResponse.json(
        { error: "Organization name is required" },
        { status: 400 }
      );
    }
    if (Number.isNaN(numEmployees)) {
      return NextResponse.json(
        { error: "numEmployees must be a non-negative number" },
        { status: 400 }
      );
    }
    if (foundedYearRaw && foundedYear == null) {
      return NextResponse.json(
        { error: "foundedYear must be a valid 4-digit year" },
        { status: 400 }
      );
    }

    // 5) Validate website + consent
    let websiteUrl: string | null = null;
    if (websiteUrlRaw.length > 0) {
      if (!isValidHttpUrl(websiteUrlRaw)) {
        return NextResponse.json(
          { error: "Website URL must be a valid http(s) URL" },
          { status: 400 }
        );
      }
      if (!websiteConsent) {
        return NextResponse.json(
          { error: "Website consent is required when providing a website URL" },
          { status: 400 }
        );
      }
      websiteUrl = websiteUrlRaw;
    }

    // 6) Temporary tester gate: global workspace cap
    const workplacesCountSnap = await adminDb.collection("organizations").count().get();
    const workplacesCount = workplacesCountSnap.data().count;
    if (workplacesCount >= MAX_WORKPLACES) {
      return NextResponse.json(
        {
          error:
            "Tester workplace limit reached. This environment is capped at 100 workplaces.",
        },
        { status: 403 }
      );
    }

    // 7) Create org + memberships (atomic batch)
    const now = new Date();
    const orgRef = adminDb.collection("organizations").doc();
    const orgId = orgRef.id;
    
    // References for the 3-way link
    const memberRef = orgRef.collection("members").doc(uid);
    const userRef = adminDb.collection("users").doc(uid);
    const userMembershipRef = userRef.collection("memberships").doc(orgId);
    const existingUserSnap = await userRef.get();
    const existingUser = existingUserSnap.data() as { name?: unknown; position?: unknown } | undefined;
    const userName = parseOptionalString(existingUser?.name);
    const userPosition = parseOptionalString(existingUser?.position);

    const batch = adminDb.batch();

    // A: The Organization itself
    batch.set(orgRef, {
      name: orgName,
      mission,
      homeState,
      taxStatus,
      fiscalYear,
      crm,
      address,
      numEmployees,
      foundedYear,
      websiteUrl,
      websiteConsent: Boolean(websiteUrl),
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
    });

    // B: Add user to Organization's member list
    batch.set(
      memberRef,
      {
        uid,
        email,
        role: "admin",
        name: userName,
        position: userPosition,
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
      },
      { merge: true }
    );

    // C: Update User profile doc (convenience field)
    batch.set(
      userRef,
      {
        email,
        updatedAt: now,
        createdAt: now,
        lastOrgId: orgId,
        ...(userName ? { name: userName } : {}),
        ...(userPosition ? { position: userPosition } : {}),
      },
      { merge: true }
    );

    // D: NEW RULE - Add organization to User's personal membership list
    batch.set(
      userMembershipRef,
      {
        orgId,
        role: "admin",
        status: "active",
        orgName: orgName, // Cache for UI efficiency
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    await batch.commit();

    return NextResponse.json({ ok: true, orgId });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        }
      );
    }
    console.error("create-org error:", err);
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}


