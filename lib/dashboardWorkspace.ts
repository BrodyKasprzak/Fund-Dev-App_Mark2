import { collection, getCountFromServer } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";

type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DocumentSummary = {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  size: number | null;
};

export type ActivityRow = {
  id: string;
  type: "document";
  label: string;
  title: string;
  when: string | null;
  changeSummary: string | null;
};

export type DashboardWorkspaceData = {
  documentsCount: number;
  lastUpdatedAt: string | null;
  teamMembersCount: number;
  activity: ActivityRow[];
  usageDocs: DocumentSummary[];
};

type CacheEntry = {
  data: DashboardWorkspaceData | null;
  promise: Promise<DashboardWorkspaceData> | null;
};

const cache = new Map<string, CacheEntry>();

function parseDocuments(payload: unknown): DocumentSummary[] {
  const root = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  const items = Array.isArray(root?.documents) ? root.documents : [];

  const documents = items
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const rec = item as Record<string, unknown>;
      if (typeof rec.id !== "string") return null;
      return {
        id: rec.id,
        title: typeof rec.title === "string" ? rec.title : "Untitled document",
        createdAt: typeof rec.createdAt === "string" ? rec.createdAt : null,
        updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : null,
        size: typeof rec.size === "number" ? rec.size : null,
      } satisfies DocumentSummary;
    })
    .filter((docRow): docRow is DocumentSummary => Boolean(docRow));

  return documents.sort((a, b) => {
    const aTs = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTs = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTs - aTs;
  });
}

function parseActivity(payload: unknown, fallbackDocs: DocumentSummary[]): ActivityRow[] {
  const root = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  const rows = Array.isArray(root?.items)
    ? root.items
        .map((item) => {
          if (typeof item !== "object" || item === null) return null;
          const rec = item as Record<string, unknown>;
          const id = typeof rec.id === "string" ? rec.id : null;
          if (!id) return null;
          return {
            id,
            type: "document" as const,
            label:
              typeof rec.label === "string" && rec.label.trim()
                ? rec.label
                : "Document activity",
            title:
              typeof rec.docTitle === "string" && rec.docTitle.trim()
                ? rec.docTitle
                : "Untitled document",
            when: typeof rec.when === "string" ? rec.when : null,
            changeSummary:
              typeof rec.changeSummary === "string" && rec.changeSummary.trim()
                ? rec.changeSummary
                : null,
          } satisfies ActivityRow;
        })
        .filter((row): row is ActivityRow => row !== null)
        .slice(0, 8)
    : [];

  if (rows.length > 0) return rows;

  return fallbackDocs.slice(0, 8).map((docRow) => ({
    id: docRow.id,
    type: "document",
    label: "Document uploaded",
    title: docRow.title || "Untitled document",
    when: docRow.createdAt || docRow.updatedAt || null,
    changeSummary: null,
  }));
}

export function makeDashboardWorkspaceCacheKey(userId: string, orgId: string) {
  return `${userId}::${orgId}`;
}

export function getDashboardWorkspaceFromCache(key: string) {
  return cache.get(key)?.data ?? null;
}

export async function fetchDashboardWorkspaceData(params: {
  authedFetch: AuthedFetch;
  orgId: string;
}) {
  const { authedFetch, orgId } = params;
  const [documentsRes, activityRes, membersCountSnap] = await Promise.all([
    authedFetch("/api/documents"),
    authedFetch("/api/activity/recent?limit=20"),
    getCountFromServer(collection(db, "organizations", orgId, "members")),
  ]);

  if (!documentsRes.ok) {
    throw new Error(`Failed to load documents (${documentsRes.status})`);
  }
  if (!activityRes.ok) {
    throw new Error(`Failed to load activity (${activityRes.status})`);
  }

  const documentsPayload = await documentsRes.json().catch(() => ({}));
  const activityPayload = await activityRes.json().catch(() => ({}));

  const usageDocs = parseDocuments(documentsPayload);
  const activity = parseActivity(activityPayload, usageDocs);

  return {
    documentsCount: usageDocs.length,
    lastUpdatedAt: usageDocs[0]?.updatedAt || usageDocs[0]?.createdAt || null,
    teamMembersCount: membersCountSnap.data().count,
    activity,
    usageDocs,
  } satisfies DashboardWorkspaceData;
}

export async function loadDashboardWorkspaceWithCache(params: {
  cacheKey: string;
  load: () => Promise<DashboardWorkspaceData>;
  force?: boolean;
}) {
  const { cacheKey, load, force = false } = params;
  const entry = cache.get(cacheKey) ?? { data: null, promise: null };

  if (!force && entry.data) {
    return entry.data;
  }

  if (!force && entry.promise) {
    return entry.promise;
  }

  const promise = load()
    .then((data) => {
      cache.set(cacheKey, { data, promise: null });
      return data;
    })
    .catch((error) => {
      cache.set(cacheKey, { data: null, promise: null });
      throw error;
    });

  // Keep prior data during forced refreshes so the UI can stay stable.
  cache.set(cacheKey, { data: entry.data, promise });
  return promise;
}
