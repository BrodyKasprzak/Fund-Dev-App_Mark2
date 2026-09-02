"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";

type SupportedType = "docx" | "pdf";

type AnalyzeFileSuccess = {
  status: "ok";
  fileName: string;
  fileType: string;
  size: number;
  detectedType: SupportedType;
  durationMs: number;
  summary: {
    textLength: number;
    preview: string;
    warnings: string[];
  };
  docx?: {
    htmlLength: number;
    editorStateBytes: number | null;
    importSummary: {
      mappedFeatures: string[];
      downgradedFeatures: string[];
      fallbackUsed: boolean;
    };
  };
  pdf?: {
    pageCount: number | null;
    metadataTitle: string | null;
    metadataProducer: string | null;
  };
};

type AnalyzeFileFailure = {
  status: "error";
  fileName: string;
  fileType: string;
  size: number;
  detectedType: SupportedType | "unsupported";
  durationMs: number;
  error: string;
};

type AnalyzeResponse = {
  ok?: boolean;
  error?: string;
  analyzedAt?: string;
  resultCount?: number;
  results?: Array<AnalyzeFileSuccess | AnalyzeFileFailure>;
};

const MAX_FILES_PER_BATCH = 10;

function fileIdentity(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value.toFixed(value >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`;
}

function formatMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export default function DocumentsLabPage() {
  const { user, loading, activeOrgId } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [response, setResponse] = useState<AnalyzeResponse | null>(null);

  const readyToRun = Boolean(user && activeOrgId && files.length > 0 && !running);
  const sortedFiles = useMemo(
    () => files.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [files],
  );

  const handleAddFiles = (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return;

    const existing = [...files];
    const seen = new Set(existing.map(fileIdentity));
    const merged = [...existing];

    let addedCount = 0;
    let duplicateCount = 0;
    let overflowCount = 0;

    for (const incoming of incomingFiles) {
      const key = fileIdentity(incoming);
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      if (merged.length >= MAX_FILES_PER_BATCH) {
        overflowCount += 1;
        continue;
      }
      seen.add(key);
      merged.push(incoming);
      addedCount += 1;
    }

    setFiles(merged);

    if (addedCount === 0 && duplicateCount > 0 && overflowCount === 0) {
      setSelectionMessage("No new files were added. The selected files were already in the queue.");
      return;
    }

    const parts: string[] = [];
    if (addedCount > 0) parts.push(`Added ${addedCount} file(s).`);
    if (duplicateCount > 0) parts.push(`Skipped ${duplicateCount} duplicate file(s).`);
    if (overflowCount > 0) {
      parts.push(`Skipped ${overflowCount} file(s) because the ${MAX_FILES_PER_BATCH}-file limit was reached.`);
    }
    setSelectionMessage(parts.join(" "));
  };

  const handleRemoveFile = (target: File) => {
    const key = fileIdentity(target);
    setFiles((prev) => prev.filter((file) => fileIdentity(file) !== key));
    setSelectionMessage("Removed 1 file from the queue.");
  };

  const handleAnalyze = async () => {
    if (!user) {
      setError("Please sign in first.");
      return;
    }
    if (!activeOrgId) {
      setError("Select an active org before running lab analysis.");
      return;
    }
    if (files.length === 0) {
      setError("Choose at least one DOCX/PDF file.");
      return;
    }

    setRunning(true);
    setError(null);
    setResponse(null);

    try {
      const token = await user.getIdToken();
      const form = new FormData();
      files.forEach((file) => form.append("files", file));

      const res = await fetch("/api/internal/documents-lab/analyze", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-org-id": activeOrgId,
        },
        body: form,
      });

      const data = (await res.json().catch(() => ({}))) as AnalyzeResponse;
      if (!res.ok) {
        throw new Error(data?.error || "Analysis failed.");
      }
      setResponse(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Documents Lab</p>
          <h1 className="mt-2 text-2xl font-semibold">DOCX/PDF Fidelity Test Bench</h1>
          <p className="mt-2 text-sm text-slate-600">
            Upload sample files and inspect import quality signals before we wire deeper round-trip
            scoring.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-1">
              Auth: {loading ? "Checking..." : user ? "Signed in" : "Signed out"}
            </span>
            <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-1">
              Org: {activeOrgId || "Not selected"}
            </span>
            <Link
              href="/documents"
              className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 font-semibold text-sky-700 hover:bg-sky-100"
            >
              Back to Documents
            </Link>
          </div>
        </header>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Run Analysis</h2>
          <p className="mt-1 text-sm text-slate-600">
            Select up to {MAX_FILES_PER_BATCH} files (DOCX/PDF).
          </p>

          <input
            type="file"
            accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            onChange={(event) => {
              const nextFiles = Array.from(event.target.files || []);
              handleAddFiles(nextFiles);
              event.currentTarget.value = "";
            }}
          />

          {selectionMessage ? (
            <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              {selectionMessage}
            </p>
          ) : null}

          {sortedFiles.length > 0 ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Selected Files ({sortedFiles.length})
              </p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {sortedFiles.map((file) => (
                  <li
                    key={`${file.name}-${file.lastModified}`}
                    className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5"
                  >
                    <span className="truncate">
                      {file.name} ({formatBytes(file.size)})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(file)}
                      disabled={running}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!readyToRun}
              onClick={() => void handleAnalyze()}
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {running ? "Analyzing..." : "Analyze Files"}
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => {
                setFiles([]);
                setError(null);
                setSelectionMessage(null);
                setResponse(null);
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reset
            </button>
          </div>
        </section>

        {response?.results?.length ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Results</h2>
              <p className="text-xs text-slate-500">
                {response.resultCount || response.results.length} file(s) •{" "}
                {response.analyzedAt ? new Date(response.analyzedAt).toLocaleString() : "Now"}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {response.results.map((result, idx) => (
                <article
                  key={`${result.fileName}-${idx}`}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{result.fileName}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        result.status === "ok"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {result.status === "ok" ? "OK" : "Error"}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-600">
                    {result.detectedType.toUpperCase()} • {formatBytes(result.size)} •{" "}
                    {formatMs(result.durationMs)}
                  </p>

                  {result.status === "error" ? (
                    <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-sm text-rose-800">
                      {result.error}
                    </p>
                  ) : null}

                  {result.status === "ok" ? (
                    <>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                          <p className="font-semibold text-slate-800">Text Extraction</p>
                          <p className="mt-1 text-slate-700">
                            Characters: {result.summary.textLength.toLocaleString()}
                          </p>
                        </div>

                        {result.detectedType === "docx" && result.docx ? (
                          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                            <p className="font-semibold text-slate-800">DOCX Import</p>
                            <p className="mt-1 text-slate-700">
                              HTML chars: {result.docx.htmlLength.toLocaleString()}
                            </p>
                            <p className="text-slate-700">
                              Editor bytes:{" "}
                              {result.docx.editorStateBytes === null
                                ? "n/a"
                                : result.docx.editorStateBytes.toLocaleString()}
                            </p>
                            <p className="text-slate-700">
                              Fallback used: {result.docx.importSummary.fallbackUsed ? "Yes" : "No"}
                            </p>
                          </div>
                        ) : null}

                        {result.detectedType === "pdf" && result.pdf ? (
                          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                            <p className="font-semibold text-slate-800">PDF Metadata</p>
                            <p className="mt-1 text-slate-700">
                              Pages: {result.pdf.pageCount ?? "Unknown"}
                            </p>
                            <p className="text-slate-700">
                              Title: {result.pdf.metadataTitle || "None"}
                            </p>
                            <p className="text-slate-700">
                              Producer: {result.pdf.metadataProducer || "None"}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {result.detectedType === "docx" && result.docx ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                            <p className="font-semibold text-emerald-800">Mapped Features</p>
                            <p className="mt-1 text-slate-700">
                              {result.docx.importSummary.mappedFeatures.join(", ") || "None"}
                            </p>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                            <p className="font-semibold text-amber-800">Downgraded Features</p>
                            <p className="mt-1 text-slate-700">
                              {result.docx.importSummary.downgradedFeatures.join(", ") || "None"}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {result.summary.warnings.length > 0 ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <p className="font-semibold">Warnings</p>
                          <ul className="mt-1 list-disc pl-5">
                            {result.summary.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <summary className="cursor-pointer font-semibold text-slate-800">
                          Text Preview
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs text-slate-700">
                          {result.summary.preview || "(No preview text)"}
                        </pre>
                      </details>
                    </>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">How You Can Help Right Now</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Create or collect 30-50 test DOCX/PDF files (easy, medium, hard).</li>
            <li>Drop them into `testing/documents-corpus/` and run this lab page on each batch.</li>
            <li>Flag files where downgraded features look high or text preview looks wrong.</li>
            <li>Tag scanned PDFs separately; they will need OCR in the next phase.</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
