import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth, errorToResponse } from "@/lib/serverAuth";

export const runtime = "nodejs";
const MAX_PROFILE_NAME_LENGTH = 120;

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function isRetryableFirestoreAuthError(err: unknown) {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("unauthenticated") ||
    msg.includes("invalid authentication credentials") ||
    msg.includes("oauth 2 access token") ||
    msg.includes("credentials could not be loaded") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("deadline exceeded") ||
    msg.includes("unavailable")
  );
}

async function readWithRetry<T>(
  label: string,
  op: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 5;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await op();
    } catch (err: unknown) {
      lastErr = err;
      const retryable = isRetryableFirestoreAuthError(err);
      console.warn("[api/me] firestore read failed", { label, attempt, maxAttempts, retryable });
      if (!retryable || attempt >= maxAttempts) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }

  throw lastErr;
}

type OrgSummary = {
  orgId: string;
  role: string;
  status: string;
  name: string | null;
};

type UserRecord = {
  lastOrgId?: unknown;
  name?: unknown;
  position?: unknown;
};

type MembershipIndexRecord = {
  orgId?: unknown;
  role?: unknown;
  status?: unknown;
  orgName?: unknown;
};

type OrgMemberRecord = {
  uid?: unknown;
  role?: unknown;
  status?: unknown;
};

type UpdateMeBody = {
  name?: unknown;
};

export async function GET(req: Request) {
  try {
    const { uid, email } = await requireAuth(req);

    const userRef = adminDb.collection("users").doc(uid);
    let userDocReadFailed = false;
    let membershipsIndexReadFailed = false;
    let canonicalValidationFailures = 0;
    let fallbackCollectionGroupFailed = false;

    let user: UserRecord = {};
    try {
      const userSnap = await readWithRetry("users/{uid}.get", () => userRef.get());
      user = (userSnap.data() as UserRecord | undefined) ?? {};
    } catch {
      userDocReadFailed = true;
      console.warn("[api/me] user doc read failed", { uid });
    }

    let membershipsSnapOrNull: FirebaseFirestore.QuerySnapshot | null = null;
    try {
      membershipsSnapOrNull = await readWithRetry("users/{uid}/memberships.get", () =>
        userRef.collection("memberships").get(),
      );
    } catch {
      membershipsIndexReadFailed = true;
      console.warn("[api/me] memberships index read failed", { uid });
    }

    const lastOrgId = asNonEmptyString(user.lastOrgId);
    const membershipDocs = membershipsSnapOrNull?.docs ?? [];
    const indexedNameByOrgId = new Map<string, string | null>();

    // Membership index (fast path), re-validated against canonical org membership.
    const indexedOrgs: OrgSummary[] = membershipDocs
      .map((d) => {
        const m = d.data() as MembershipIndexRecord;
        const orgId = asNonEmptyString(m.orgId) ?? d.id;
        if (!orgId) return null;
        const orgName = asNonEmptyString(m.orgName);
        indexedNameByOrgId.set(orgId, orgName);
        return {
          orgId,
          role: asNonEmptyString(m.role) ?? "member",
          status: asNonEmptyString(m.status) ?? "active",
          name: orgName,
        } satisfies OrgSummary;
      })
      .filter((item): item is OrgSummary => Boolean(item));

    const validated = await Promise.all(
      indexedOrgs.map(async (indexed) => {
        try {
          const memberSnap = await readWithRetry(
            `organizations/${indexed.orgId}/members/${uid}.get`,
            () =>
              adminDb
                .collection("organizations")
                .doc(indexed.orgId)
                .collection("members")
                .doc(uid)
                .get(),
          );

          if (!memberSnap.exists) return null;
          const canonical = memberSnap.data() as OrgMemberRecord | undefined;
          return {
            orgId: indexed.orgId,
            role: asNonEmptyString(canonical?.role) ?? indexed.role,
            status: asNonEmptyString(canonical?.status) ?? indexed.status,
            name: indexed.name,
          } satisfies OrgSummary;
        } catch {
          canonicalValidationFailures += 1;
          console.warn("[api/me] canonical membership validation failed", { uid, orgId: indexed.orgId });
          return null;
        }
      }),
    );

    let orgs: OrgSummary[] = validated.filter((item): item is OrgSummary => Boolean(item));

    async function loadFromCanonicalMembershipsCollectionGroup(): Promise<OrgSummary[] | null> {
      try {
        const membersSnap = await readWithRetry("collectionGroup(members).where(uid==...).get", () =>
          adminDb
            .collectionGroup("members")
            .where("uid", "==", uid)
            .get(),
        );

        const byOrgId = new Map<string, OrgSummary>();
        for (const docSnap of membersSnap.docs) {
          const orgRef = docSnap.ref.parent.parent;
          const orgId = asNonEmptyString(orgRef?.id);
          if (!orgId) continue;

          const member = docSnap.data() as OrgMemberRecord;
          byOrgId.set(orgId, {
            orgId,
            role: asNonEmptyString(member.role) ?? "member",
            status: asNonEmptyString(member.status) ?? "active",
            name: indexedNameByOrgId.get(orgId) ?? null,
          });
        }

        if (byOrgId.size === 0) return [];

        const baseOrgs = Array.from(byOrgId.values());
        const namesToResolve = baseOrgs.filter((o) => !o.name);
        if (namesToResolve.length === 0) return baseOrgs;

        const orgNamePairs = await Promise.all(
          namesToResolve.map(async (row) => {
            try {
              const orgSnap = await readWithRetry(`organizations/${row.orgId}.get`, () =>
                adminDb.collection("organizations").doc(row.orgId).get(),
              );
              const raw = (orgSnap.data() ?? {}) as Record<string, unknown>;
              const name = asNonEmptyString(raw.name);
              return [row.orgId, name] as const;
            } catch {
              return [row.orgId, null] as const;
            }
          }),
        );

        const fetchedNames = new Map<string, string | null>(orgNamePairs);
        return baseOrgs.map((row) => ({
          ...row,
          name: row.name ?? fetchedNames.get(row.orgId) ?? null,
        }));
      } catch {
        fallbackCollectionGroupFailed = true;
        console.warn("[api/me] collectionGroup fallback membership read failed", { uid });
        return null;
      }
    }

    // Canonical fallback for transient index/validation failures and for users not backfilled.
    if (orgs.length === 0) {
      const fromCanonicalGroup = await loadFromCanonicalMembershipsCollectionGroup();
      if (fromCanonicalGroup && fromCanonicalGroup.length > 0) {
        orgs = fromCanonicalGroup;
      }
    }

    // Final fallback: lastOrgId for legacy accounts.
    if (orgs.length === 0 && lastOrgId) {
      try {
        const memberSnap = await readWithRetry(
          `organizations/${lastOrgId}/members/${uid}.get:lastOrgFallback`,
          () =>
            adminDb
              .collection("organizations")
              .doc(lastOrgId)
              .collection("members")
              .doc(uid)
              .get(),
        );

        if (memberSnap.exists) {
          orgs = [
            {
              orgId: lastOrgId,
              role: asNonEmptyString(memberSnap.data()?.role) ?? "member",
              status: asNonEmptyString(memberSnap.data()?.status) ?? "active",
              name: indexedNameByOrgId.get(lastOrgId) ?? null,
            },
          ];
        }
      } catch {
        console.warn("[api/me] lastOrgId fallback membership read failed", { uid, orgId: lastOrgId });
      }
    }

    // If membership lookup had transient failures and produced no orgs, force client retry.
    const hadTransientLookupFailure =
      userDocReadFailed ||
      membershipsIndexReadFailed ||
      canonicalValidationFailures > 0 ||
      fallbackCollectionGroupFailed;
    if (orgs.length === 0 && hadTransientLookupFailure) {
      return NextResponse.json(
        {
          ok: false,
          error: "Temporary membership lookup failure",
          retryable: true,
          reason: {
            userDocReadFailed,
            membershipsIndexReadFailed,
            canonicalValidationFailures,
            fallbackCollectionGroupFailed,
          },
        },
        { status: 503 },
      );
    }

    const defaultOrgId =
      (lastOrgId && orgs.some((o) => o.orgId === lastOrgId) ? lastOrgId : null) ??
      (orgs.length === 1 ? orgs[0].orgId : null);

    const primary = defaultOrgId ? orgs.find((o) => o.orgId === defaultOrgId) : null;

    const org = defaultOrgId
      ? { id: defaultOrgId, name: primary?.name ?? null }
      : null;

    return NextResponse.json({
      ok: true,
      me: {
        uid,
        email,
        orgId: org?.id ?? null,
        role: primary?.role ?? null,
        org,
        name: asNonEmptyString(user.name),
        position: asNonEmptyString(user.position),
      },
      orgs,
      defaultOrgId,
    });
  } catch (err: unknown) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const { uid, email } = await requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as UpdateMeBody;
    const rawName = typeof body?.name === "string" ? body.name.trim() : "";
    if (!rawName) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (rawName.length > MAX_PROFILE_NAME_LENGTH) {
      return NextResponse.json(
        { error: `name must be ${MAX_PROFILE_NAME_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const now = new Date();
    await adminDb
      .collection("users")
      .doc(uid)
      .set(
        {
          email,
          name: rawName,
          updatedAt: now,
        },
        { merge: true },
      );

    return NextResponse.json({ ok: true, me: { uid, email, name: rawName } });
  } catch (err: unknown) {
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
