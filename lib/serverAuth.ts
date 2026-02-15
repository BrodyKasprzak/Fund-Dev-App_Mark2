import { getAuth } from "firebase-admin/auth";
import { adminDb } from "@/lib/firebaseAdmin";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type AuthContext = {
  uid: string;
  email: string | null;
};

type OrgContext = AuthContext & {
  orgId: string;
  role: string;
};

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing auth token");
  }

  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) throw new HttpError(401, "Missing auth token");

  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
}

export async function requireOrgContext(req: Request): Promise<OrgContext> {
  const { uid, email } = await requireAuth(req);

  const orgId = asNonEmptyString(req.headers.get("x-org-id"));
  if (!orgId) throw new HttpError(400, "Missing org context");

  const memberRef = adminDb
    .collection("organizations")
    .doc(orgId)
    .collection("members")
    .doc(uid);

  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) throw new HttpError(403, "Not a member of this org");

  const role = asNonEmptyString(memberSnap.data()?.role) ?? "member";

  return { uid, email, orgId, role };
}

export async function requireAdmin(req: Request): Promise<OrgContext> {
  const ctx = await requireOrgContext(req);
  if (ctx.role !== "admin") throw new HttpError(403, "Admin only");
  return ctx;
}

export function errorToResponse(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  if (err instanceof Error) {
    if (process.env.NODE_ENV !== "production") {
      return { status: 500, message: err.message || "Server error" };
    }
    return { status: 500, message: "Server error" };
  }
  return { status: 500, message: "Server error" };
}



