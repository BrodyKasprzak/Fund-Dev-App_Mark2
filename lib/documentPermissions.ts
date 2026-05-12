import type { OrgRole } from "@/lib/permissions";

export const DOCUMENT_ACCESS_MODES = ["org", "restricted"] as const;

export type DocumentAccessMode = (typeof DOCUMENT_ACCESS_MODES)[number];

export type DocumentPermissions = {
  accessMode: DocumentAccessMode;
  allowedMemberUids: string[];
  ragEnabled: boolean;
  updatedBy: string | null;
};

type RawDocumentPermissionRecord = {
  docAccessMode?: unknown;
  docAllowedMemberUids?: unknown;
  docRagEnabled?: unknown;
  docPermissionsUpdatedBy?: unknown;
};

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeDocumentAccessMode(value: unknown): DocumentAccessMode {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === "restricted") return "restricted";
  return "org";
}

export function normalizeAllowedMemberUids(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of value) {
    const uid = asNonEmptyString(entry);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    output.push(uid);
    if (output.length >= 500) break;
  }
  return output;
}

export function normalizeDocumentPermissions(
  record: RawDocumentPermissionRecord | null | undefined,
): DocumentPermissions {
  return {
    accessMode: normalizeDocumentAccessMode(record?.docAccessMode),
    allowedMemberUids: normalizeAllowedMemberUids(record?.docAllowedMemberUids),
    ragEnabled: record?.docRagEnabled !== false,
    updatedBy: asNonEmptyString(record?.docPermissionsUpdatedBy),
  };
}

export function userCanReadDocument(args: {
  permissions: DocumentPermissions;
  uid: string;
  role: OrgRole;
}) {
  const { permissions, uid, role } = args;
  if (role === "admin") return true;
  if (permissions.accessMode === "org") return true;
  return permissions.allowedMemberUids.includes(uid);
}

export function documentAllowedInRag(permissions: DocumentPermissions) {
  return permissions.ragEnabled;
}

