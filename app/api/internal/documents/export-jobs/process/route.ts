import { NextResponse } from "next/server";
import { processDocumentExportQueueBatch } from "@/lib/documents/exportJobs";

export const runtime = "nodejs";

const MAX_BATCH_JOBS = 20;

function parseMaxJobs(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(MAX_BATCH_JOBS, Math.floor(value)));
}

function parseWorkerId(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 80);
  return cleaned || null;
}

function hasValidWorkerSecret(req: Request) {
  const expected = process.env.DOCUMENT_EXPORT_WORKER_SECRET?.trim();
  if (!expected) return false;
  const provided = req.headers.get("x-export-worker-secret")?.trim();
  return Boolean(provided && provided === expected);
}

export async function POST(req: Request) {
  if (!hasValidWorkerSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      maxJobs?: unknown;
      workerId?: unknown;
    };

    const maxJobs = parseMaxJobs(body.maxJobs);
    const workerId = parseWorkerId(body.workerId);
    const result = await processDocumentExportQueueBatch({
      maxJobs,
      workerId: workerId || undefined,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Export worker failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
