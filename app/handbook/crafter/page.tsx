"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";

type StepKey = "handbook" | "website" | "policies" | "irs" | "review";

type UploadItem = {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n = n / 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function StepPill({
  index,
  title,
  active,
  done,
}: {
  index: number;
  title: string;
  active?: boolean;
  done?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center gap-3 rounded-xl border px-4 py-3",
        active ? "border-slate-900 bg-white" : "border-slate-200 bg-slate-50",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
          done
            ? "bg-success-400 text-white"
            : active
            ? "bg-slate-900 text-white"
            : "bg-slate-200 text-slate-700",
        ].join(" ")}
      >
        {done ? "✓" : index}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{title}</div>
      </div>
    </div>
  );
}

function FileDropzone({
  label,
  hint,
  accept,
  multiple,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
  items: UploadItem[];
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        {hint ? <div className="mt-1 text-xs text-slate-600">{hint}</div> : null}
      </div>

      <div className="p-4">
        <div
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center hover:bg-slate-100"
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          <div className="text-sm font-medium text-slate-900">Click to upload</div>
          <div className="mt-1 text-xs text-slate-600">
            {multiple ? "Upload one or more files" : "Upload a file"}{" "}
            {accept ? `(${accept})` : ""}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple={multiple}
          onChange={(e) => onAdd(e.target.files)}
        />

        {items.length > 0 ? (
          <div className="mt-4 space-y-2">
            {items.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {it.name}
                  </div>
                  <div className="text-xs text-slate-600">
                    {formatBytes(it.size)}
                    {it.type ? ` • ${it.type}` : ""}
                  </div>
                </div>

                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                  onClick={() => onRemove(it.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function FundDevHandbookCrafterPage() {
  const router = useRouter();
  const params = useSearchParams();
  const planId = params.get("planId");

  const { user, loading } = useAuth();

  // ✅ NEW: org context gate
  const [checkingOrg, setCheckingOrg] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  useEffect(() => {
    async function guardOrg() {
      if (loading) return;

      if (!user) {
        setCheckingOrg(false);
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        const data = snap.exists() ? snap.data() : null;

        const candidate =
          localStorage.getItem("pf_active_org") ||
          (typeof data?.lastOrgId === "string" ? data.lastOrgId : null);

        if (!candidate) {
          router.push("/onboarding/org");
          return;
        }

        const memberRef = doc(db, "organizations", candidate, "members", user.uid);
        const memberSnap = await getDoc(memberRef);

        if (!memberSnap.exists()) {
          localStorage.removeItem("pf_active_org");
          router.push("/onboarding/org");
          return;
        }

        // ✅ We have a valid org context
        localStorage.setItem("pf_active_org", candidate);
        setOrgId(candidate);
      } catch (e) {
        console.error("Org gate error:", e);
        router.push("/onboarding/org");
        return;
      } finally {
        setCheckingOrg(false);
      }
    }

    guardOrg();
  }, [user, loading, router]);

  // ---------------------------
  // Wizard state (UI-only for now)
  // ---------------------------
  const [step, setStep] = useState<StepKey>("handbook");

  const [hasHandbook, setHasHandbook] = useState<"yes" | "no" | "unsure">("unsure");
  const [handbookUploads, setHandbookUploads] = useState<UploadItem[]>([]);

  const [websitePermission, setWebsitePermission] = useState<"yes" | "no" | "unset">(
    "unset"
  );
  const [websiteScopeOk, setWebsiteScopeOk] = useState(false);

  const [hasPoliciesDocs, setHasPoliciesDocs] = useState<"yes" | "no" | "unset">(
    "unset"
  );
  const [policyUploads, setPolicyUploads] = useState<UploadItem[]>([]);

  const [irsPermission, setIrsPermission] = useState<"yes" | "no" | "unset">(
    "unset"
  );
  const [filedNonprofitName, setFiledNonprofitName] = useState("");
  const [ein, setEin] = useState("");

  const steps = useMemo(
    () => [
      { key: "handbook" as const, title: "Existing handbook (optional)" },
      { key: "website" as const, title: "Website permission" },
      { key: "policies" as const, title: "Policies & procedures" },
      { key: "irs" as const, title: "IRS business master file" },
      { key: "review" as const, title: "Review" },
    ],
    []
  );

  const stepIndex = steps.findIndex((s) => s.key === step);

  function addUploads(
    setter: React.Dispatch<React.SetStateAction<UploadItem[]>>,
    files: FileList | null
  ) {
    if (!files || files.length === 0) return;
    const next: UploadItem[] = [];
    for (const f of Array.from(files)) {
      next.push({
        id: `${f.name}-${f.size}-${f.lastModified}-${crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)}`,
        name: f.name,
        size: f.size,
        type: f.type,
        file: f,
      });
    }
    setter((prev) => [...prev, ...next]);
  }

  function removeUpload(
    setter: React.Dispatch<React.SetStateAction<UploadItem[]>>,
    id: string
  ) {
    setter((prev) => prev.filter((x) => x.id !== id));
  }

  function normalizeEin(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 9);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }

  const canGoNext = useMemo(() => {
    if (step === "handbook") {
      if (hasHandbook === "yes") return handbookUploads.length > 0;
      if (hasHandbook === "no") return true;
      return false;
    }
    if (step === "website") {
      if (websitePermission === "unset") return false;
      if (websitePermission === "yes") return websiteScopeOk;
      return true;
    }
    if (step === "policies") {
      if (hasPoliciesDocs === "unset") return false;
      if (hasPoliciesDocs === "yes") return policyUploads.length > 0;
      return true;
    }
    if (step === "irs") {
      if (irsPermission === "unset") return false;
      if (irsPermission === "no") return true;
      const einDigits = ein.replace(/\D/g, "");
      return filedNonprofitName.trim().length >= 2 && einDigits.length === 9;
    }
    if (step === "review") return true;
    return true;
  }, [
    step,
    hasHandbook,
    handbookUploads.length,
    websitePermission,
    websiteScopeOk,
    hasPoliciesDocs,
    policyUploads.length,
    irsPermission,
    filedNonprofitName,
    ein,
  ]);

  function goNext() {
    const next = steps[Math.min(stepIndex + 1, steps.length - 1)]?.key;
    if (next) setStep(next);
  }

  function goBack() {
    const prev = steps[Math.max(stepIndex - 1, 0)]?.key;
    if (prev) setStep(prev);
  }

  function submitContext() {
    if (!planId) return;

    // ✅ Optional safety: ensure org is present before moving on
    const active = localStorage.getItem("pf_active_org");
    if (!active) {
      router.push("/onboarding/org");
      return;
    }

    router.push(`/handbook/crafter/template?planId=${encodeURIComponent(planId)}`);
  }

  // ✅ loading UI while checking auth + org context
  if (loading || checkingOrg) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Loading…</div>
          <div className="mt-1 text-xs text-slate-600">Verifying your workspace access.</div>
        </div>
      </main>
    );
  }

  if (!user) return null;

  if (!planId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            Fund Development Handbook Crafter
          </h1>
          <p className="mt-2 text-slate-600">
            Missing <span className="font-medium">planId</span>. Please return to Products and start again.
          </p>
          <button
            className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
            onClick={() => router.push("/products")}
          >
            Back to Products
          </button>
        </div>
      </main>
    );
  }

  // ---------------------------
  // (Your StepContent switch stays the same)
  // ---------------------------
  const StepContent = () => {
    switch (step) {
      // KEEP your existing switch cases exactly as you have them,
      // but delete the stray "úss" line in the review step.
      default:
        return null;
    }
  };

  const doneMap: Record<StepKey, boolean> = {
    handbook:
      hasHandbook !== "unsure" &&
      (hasHandbook === "no" || handbookUploads.length > 0),
    website:
      websitePermission !== "unset" &&
      (websitePermission === "no" || websiteScopeOk),
    policies:
      hasPoliciesDocs !== "unset" &&
      (hasPoliciesDocs === "no" || policyUploads.length > 0),
    irs:
      irsPermission !== "unset" &&
      (irsPermission === "no" ||
        (filedNonprofitName.trim().length >= 2 &&
          ein.replace(/\D/g, "").length === 9)),
    review: step === "review",
  };

  const readyToMoveToWorkflow =
    doneMap.handbook && doneMap.website && doneMap.policies && doneMap.irs;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Fund Development Handbook Crafter
              </h1>
              <p className="mt-2 text-slate-600">
                Provide optional context now to reduce questions later. You can skip any step and return at any time.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Active org: <span className="font-medium">{orgId ?? "—"}</span>
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium text-slate-600">Current plan</div>
              <div className="mt-1 text-sm text-slate-800">
                <span className="font-medium">planId:</span> {planId}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="space-y-3 md:col-span-1">
              {steps.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  className="w-full text-left"
                  onClick={() => setStep(s.key)}
                >
                  <StepPill
                    index={i + 1}
                    title={s.title}
                    active={s.key === step}
                    done={doneMap[s.key]}
                  />
                </button>
              ))}

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-900">
                  Move to handbook workflow
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  When the context steps are complete, you can begin the section-by-section handbook workflow.
                </p>

                <button
                  type="button"
                  disabled={!readyToMoveToWorkflow}
                  className={[
                    "mt-3 w-full rounded-md px-4 py-2 text-sm font-medium",
                    readyToMoveToWorkflow
                      ? "bg-success-400 text-white hover:bg-success-500"
                      : "bg-slate-200 text-slate-600 cursor-not-allowed",
                  ].join(" ")}
                  onClick={() => setStep("review")}
                >
                  {readyToMoveToWorkflow ? "Start handbook workflow" : "Complete steps to continue"}
                </button>
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <StepContent />

                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 bg-white px-4 py-2 text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={goBack}
                      disabled={stepIndex === 0}
                    >
                      Back
                    </button>

                    {step !== "review" ? (
                      <button
                        type="button"
                        className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={goNext}
                        disabled={!canGoNext}
                      >
                        Next
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
                        onClick={submitContext}
                      >
                        Save & start handbook workflow
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 bg-white px-4 py-2 text-slate-800 hover:bg-slate-100"
                      onClick={() => {
                        router.push(`/handbook/crafter/template?planId=${encodeURIComponent(planId)}`);
                      }}
                    >
                      Open plan editor
                    </button>
                  </div>
                </div>

                <p className="mt-6 text-xs text-slate-500">
                  Note: This is UI/UX scaffolding only. Next step is wiring uploads to server-side storage and persisting permissions to{" "}
                  <span className="font-medium">plan.data</span>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}


     