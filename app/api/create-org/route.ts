// app/api/create-org/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getAuth } from "firebase-admin/auth";

export const runtime = "nodejs";

function isValidHttpUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseOptionalString(v: any) {
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
    // 🔐 1) Auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
    }
    const idToken = authHeader.split("Bearer ")[1];

    // 🔐 2) Verify token
    const decoded = await getAuth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email ?? null;

    // 3) Parse body
    const body = await req.json().catch(() => ({}));

    const orgName = String(body?.orgName ?? "").trim();
    const mission = parseOptionalString(body?.mission);
    const homeState = parseOptionalString(body?.homeState);
    const taxStatus = parseOptionalString(body?.taxStatus);
    const fiscalYear = parseOptionalString(body?.fiscalYear);
    const crm = parseOptionalString(body?.crm);
    const address = parseOptionalString(body?.address);

    const foundedYearRaw = parseOptionalString(body?.foundedYear);
    const foundedYear =
      foundedYearRaw && isValidYearStr(foundedYearRaw) ? Number(foundedYearRaw) : null;

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
    if (!orgName) {
      return NextResponse.json(
        { error: "Organization name is required" },
        { status: 400 }
      );
    }

    // Validate employees if provided (reject NaN)
    if (Number.isNaN(numEmployees as any)) {
      return NextResponse.json(
        { error: "numEmployees must be a non-negative number" },
        { status: 400 }
      );
    }

    // Validate foundedYear if provided but invalid
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

    // 6) Create organization
    const now = new Date();

    const orgRef = await adminDb.collection("organizations").add({
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

    // 7) Create/update user profile (org context)
    //    - don't overwrite createdAt if user doc already exists
    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const alreadyHasCreatedAt = userSnap.exists && userSnap.data()?.createdAt;

    const userPatch: Record<string, any> = {
      orgId: orgRef.id,
      role: "admin",
      email,
      updatedAt: now,
    };

    if (!alreadyHasCreatedAt) {
      userPatch.createdAt = now;
    }

    await userRef.set(userPatch, { merge: true });

    // 8) REQUIRED for Option A rules:
    //    Create membership doc so org reads are authorized by membership
    await adminDb
      .collection("organizations")
      .doc(orgRef.id)
      .collection("members")
      .doc(uid)
      .set(
        {
          uid,
          email,
          role: "admin",
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

    return NextResponse.json({ ok: true, orgId: orgRef.id });
  } catch (err: any) {
    console.error("create-org error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
