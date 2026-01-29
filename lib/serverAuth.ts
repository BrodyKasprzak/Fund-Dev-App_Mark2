import { getAuth } from "firebase-admin/auth";
import { adminDb } from "@/lib/firebaseAdmin";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireAuth(req: Request) {
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

export async function requireOrgContext(req: Request) {
  const { uid, email } = await requireAuth(req);

  const snap = await adminDb.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpError(403, "User profile not found");

  const data = snap.data() as any;
  if (!data?.orgId) throw new HttpError(403, "User has no org");

  return {
    uid,
    email,
    orgId: String(data.orgId),
    role: String(data.role ?? "member"), // safe default
  };
}

export async function requireAdmin(req: Request) {
  const ctx = await requireOrgContext(req);
  if (ctx.role !== "admin") throw new HttpError(403, "Admin only");
  return ctx;
}

export function errorToResponse(err: any) {
  const status = err?.status ?? 500;
  const message = err?.message ?? "Server error";
  return { status, message };
}
