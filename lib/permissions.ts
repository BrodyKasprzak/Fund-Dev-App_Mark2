export const ORG_ROLES = ["admin", "editor", "viewer", "board_member"] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_CAPABILITIES = [
  "documents.read",
  "documents.write",
  "invites.manage",
  "members.read",
  "members.manage",
  "plans.read",
  "plans.write",
  "organization.read",
  "organization.write",
] as const;

export type OrgCapability = (typeof ORG_CAPABILITIES)[number];

const LEGACY_ROLE_ALIASES: Record<string, OrgRole> = {
  member: "editor",
};

export const DEFAULT_ORG_ROLE: OrgRole = "editor";

const ROLE_CAPABILITIES: Record<OrgRole, ReadonlySet<OrgCapability>> = {
  admin: new Set(ORG_CAPABILITIES),
  editor: new Set([
    "documents.read",
    "documents.write",
    "members.read",
    "plans.read",
    "plans.write",
    "organization.read",
  ]),
  board_member: new Set([
    "documents.read",
    "documents.write",
    "members.read",
    "plans.read",
    "plans.write",
    "organization.read",
  ]),
  viewer: new Set([
    "documents.read",
    "members.read",
    "plans.read",
    "organization.read",
  ]),
};

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: "Admin",
  editor: "Member (editor)",
  viewer: "Member (viewer)",
  board_member: "Board member (editor)",
};

function asCleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function normalizeOrgRole(value: unknown, fallback: OrgRole = DEFAULT_ORG_ROLE): OrgRole {
  const cleaned = asCleanString(value);
  if (!cleaned) return fallback;
  if (isOrgRole(cleaned)) return cleaned;

  const aliased = LEGACY_ROLE_ALIASES[cleaned];
  return aliased ?? fallback;
}

export function hasOrgCapability(role: OrgRole, capability: OrgCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function canManageMembers(role: OrgRole): boolean {
  return role === "admin";
}

export function getOrgRoleLabel(role: OrgRole): string {
  return ROLE_LABELS[role];
}
