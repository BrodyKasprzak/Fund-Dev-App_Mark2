"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

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

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  // ---------------------------
  // Wizard state (UI-only for now)
  // ---------------------------
  const [step, setStep] = useState<StepKey>("handbook");

  // Step 1: Handbook upload
  const [hasHandbook, setHasHandbook] = useState<"yes" | "no" | "unsure">(
    "unsure"
  );
  const [handbookUploads, setHandbookUploads] = useState<UploadItem[]>([]);

  // Step 2: Website scrape permission
  const [websitePermission, setWebsitePermission] = useState<
    "yes" | "no" | "unset"
  >("unset");
  const [websiteScopeOk, setWebsiteScopeOk] = useState(false);

  // Step 3: Policies/procedures uploads (now a yes/no gate)
  const [hasPoliciesDocs, setHasPoliciesDocs] = useState<
    "yes" | "no" | "unset"
  >("unset");
  const [policyUploads, setPolicyUploads] = useState<UploadItem[]>([]);

  // Step 4: IRS business master file permission + EIN/Name
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
        id: `${f.name}-${f.size}-${f.lastModified}-${
          crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)
        }`,
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
      return false; // unsure
    }
    if (step === "website") {
      if (websitePermission === "unset") return false;
      if (websitePermission === "yes") return websiteScopeOk;
      return true;
    }
    if (step === "policies") {
      if (hasPoliciesDocs === "unset") return false;
      if (hasPoliciesDocs === "yes") return policyUploads.length > 0;
      return true; // no
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

  router.push(
    `/handbook/crafter/template?planId=${encodeURIComponent(planId)}`
  );
}


  if (!planId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            Fund Development Handbook Crafter
          </h1>
          <p className="mt-2 text-slate-600">
            Missing <span className="font-medium">planId</span>. Please return to
            Products and start again.
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

  const StepContent = () => {
    switch (step) {
      case "handbook":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Do you already have a handbook?
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                If you have an existing fund development handbook—or any similar
                fundraising operations document—upload it here. If not, you can
                continue and we’ll build from scratch.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-medium text-slate-900">
                Existing handbook
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {[
                  { k: "yes" as const, t: "Yes, I have one" },
                  { k: "no" as const, t: "No, not yet" },
                  { k: "unsure" as const, t: "Not sure" },
                ].map((opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    className={[
                      "rounded-xl border px-4 py-3 text-left",
                      hasHandbook === opt.k
                        ? "border-slate-900 bg-white"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                    ].join(" ")}
                    onClick={() => setHasHandbook(opt.k)}
                  >
                    <div className="text-sm font-medium text-slate-900">
                      {opt.t}
                    </div>
                    {opt.k === "yes" ? (
                      <div className="mt-1 text-xs text-slate-600">
                        Upload on the next panel.
                      </div>
                    ) : opt.k === "no" ? (
                      <div className="mt-1 text-xs text-slate-600">
                        We’ll guide you step-by-step.
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-600">
                        You can decide later.
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {hasHandbook === "yes" ? (
              <FileDropzone
                label="Upload existing handbook (PDF or DOCX recommended)"
                hint="If you have multiple versions, upload the most recent. Drafts are okay."
                accept=".pdf,.doc,.docx"
                multiple
                items={handbookUploads}
                onAdd={(files) => addUploads(setHandbookUploads, files)}
                onRemove={(id) => removeUpload(setHandbookUploads, id)}
              />
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-900">
                What happens next
              </div>
              <p className="mt-1 text-sm text-slate-700">
                We’ll ask permission to use public information from your website
                to reduce how many questions we need to ask later.
              </p>
            </div>
          </div>
        );

      case "website":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Website permission
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                We can use public-facing content from your website (mission,
                programs, services, and public impact language) to pre-fill
                parts of your handbook and reduce redundant questions.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-medium text-slate-900">
                Permission to use public website content
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={[
                    "rounded-xl border px-4 py-3 text-left",
                    websitePermission === "yes"
                      ? "border-slate-900 bg-white"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                  ].join(" ")}
                  onClick={() => setWebsitePermission("yes")}
                >
                  <div className="text-sm font-medium text-slate-900">
                    Yes, you may use it
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    We will only use publicly accessible pages to extract
                    context.
                  </div>
                </button>

                <button
                  type="button"
                  className={[
                    "rounded-xl border px-4 py-3 text-left",
                    websitePermission === "no"
                      ? "border-slate-900 bg-white"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                  ].join(" ")}
                  onClick={() => setWebsitePermission("no")}
                >
                  <div className="text-sm font-medium text-slate-900">
                    No, please don’t
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    No problem—your handbook can still be built from uploads +
                    questions.
                  </div>
                </button>
              </div>

              {websitePermission === "yes" ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-900">
                    Scope (read-only)
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    <li>
                      Public pages only (e.g., About, Programs, Impact, Donate
                      landing page text)
                    </li>
                    <li>
                      We will not attempt to access private portals, payment
                      pages, or gated content
                    </li>
                    <li>
                      Purpose is to reduce manual data entry and improve
                      accuracy
                    </li>
                  </ul>

                  <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={websiteScopeOk}
                      onChange={(e) => setWebsiteScopeOk(e.target.checked)}
                    />
                    <span>
                      I understand and authorize the use of public website
                      content for this plan.
                    </span>
                  </label>

                  <div className="mt-3 text-xs text-slate-600">
                    Note: Scraping/collection will be implemented later. For now,
                    we’re capturing permission.
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-900">Next</div>
              <p className="mt-1 text-sm text-slate-700">
                Upload any fundraising-related policies and procedures (gift
                acceptance, donor recognition, finance controls, etc.).
              </p>
            </div>
          </div>
        );

      case "policies":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Policies & procedures
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                If you have any documents describing fundraising policies or
                procedures, upload them here. Drafts and informal docs are
                welcome.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-medium text-slate-900">
                Do you have fundraising-related policies or procedures to upload?
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={[
                    "rounded-xl border px-4 py-3 text-left",
                    hasPoliciesDocs === "yes"
                      ? "border-slate-900 bg-white"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                  ].join(" ")}
                  onClick={() => setHasPoliciesDocs("yes")}
                >
                  <div className="text-sm font-medium text-slate-900">
                    Yes, I’ll upload documents
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    Gift acceptance, donor recognition, gift processing, CRM SOPs, etc.
                  </div>
                </button>

                <button
                  type="button"
                  className={[
                    "rounded-xl border px-4 py-3 text-left",
                    hasPoliciesDocs === "no"
                      ? "border-slate-900 bg-white"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                  ].join(" ")}
                  onClick={() => {
                    setHasPoliciesDocs("no");
                    setPolicyUploads([]); // keep consistent if they say no
                  }}
                >
                  <div className="text-sm font-medium text-slate-900">
                    No, not right now
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    That’s okay—you can add them later.
                  </div>
                </button>
              </div>
            </div>

            {hasPoliciesDocs === "yes" ? (
              <FileDropzone
                label="Upload policies & procedures"
                hint="Examples: Gift Acceptance Policy, Donor Recognition, Gift Processing steps, CRM SOPs, Finance controls, Board-approved fundraising policies."
                accept=".pdf,.doc,.docx,.txt"
                multiple
                items={policyUploads}
                onAdd={(files) => addUploads(setPolicyUploads, files)}
                onRemove={(id) => removeUpload(setPolicyUploads, id)}
              />
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-900">Next</div>
              <p className="mt-1 text-sm text-slate-700">
                We’ll optionally collect IRS business master file information to ensure your legal name and EIN are accurate in the handbook.
              </p>
            </div>
          </div>
        );

      case "irs":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                IRS business master file
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                This step helps ensure accuracy for legal nonprofit name + EIN
                references and can reduce future back-and-forth. You can skip
                this and add it later.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-medium text-slate-900">
                Permission to use IRS business master file information
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={[
                    "rounded-xl border px-4 py-3 text-left",
                    irsPermission === "yes"
                      ? "border-slate-900 bg-white"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                  ].join(" ")}
                  onClick={() => setIrsPermission("yes")}
                >
                  <div className="text-sm font-medium text-slate-900">
                    Yes, include it
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    We’ll use it only for identification and document accuracy.
                  </div>
                </button>

                <button
                  type="button"
                  className={[
                    "rounded-xl border px-4 py-3 text-left",
                    irsPermission === "no"
                      ? "border-slate-900 bg-white"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                  ].join(" ")}
                  onClick={() => setIrsPermission("no")}
                >
                  <div className="text-sm font-medium text-slate-900">
                    No, skip for now
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    You can still complete the handbook workflow without this.
                  </div>
                </button>
              </div>

              {irsPermission === "yes" ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-900">
                      Filed nonprofit legal name
                    </label>
                    <input
                      className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      placeholder="e.g., ALPHA CENTER INC"
                      value={filedNonprofitName}
                      onChange={(e) => setFiledNonprofitName(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-slate-600">
                      Enter the name as filed with the IRS (or as shown on
                      official filings).
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-900">
                      EIN
                    </label>
                    <input
                      className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      placeholder="12-3456789"
                      value={ein}
                      onChange={(e) => setEin(normalizeEin(e.target.value))}
                      inputMode="numeric"
                    />
                    <p className="mt-1 text-xs text-slate-600">
                      Format: 2 digits, hyphen, 7 digits.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-900">Next</div>
              <p className="mt-1 text-sm text-slate-700">
                Review what you provided, then save and start the section-by-section workflow.
              </p>
            </div>
          </div>
        );

      case "review":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Review</h2>
              <p className="mt-1 text-sm text-slate-600">
                Confirm your inputs. You can edit any step before continuing.
              </p>
            </div>

            <div className="grid gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-900">
                    Existing handbook
                  </div>
                  <button
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    onClick={() => setStep("handbook")}
                  >
                    Edit
                  </button>
                </div>
                <div className="mt-2 text-sm text-slate-700">
                  <div>
                    <span className="font-medium">Status:</span>{" "}
                    {hasHandbook === "yes"
                      ? "Provided"
                      : hasHandbook === "no"
                      ? "Not available"
                      : "Not sure"}
                  </div>
                  {hasHandbook === "yes" ? (
                    <div className="mt-1">
                      <span className="font-medium">Uploads:</span>{" "}
                      {handbookUploads.length} file(s)
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-900">
                    Website permission
                  </div>
                  <button
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    onClick={() => setStep("website")}
                  >
                    Edit
                  </button>
                </div>
                <div className="mt-2 text-sm text-slate-700">
                  <div>
                    <span className="font-medium">Permission:</span>{" "}
                    {websitePermission === "yes"
                      ? "Granted"
                      : websitePermission === "no"
                      ? "Declined"
                      : "Not set"}
                  </div>
                </div>
úss
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-900">
                    Policies & procedures
                  </div>
                  <button
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    onClick={() => setStep("policies")}
                  >
                    Edit
                  </button>
                </div>
                <div className="mt-2 text-sm text-slate-700">
                  <div>
                    <span className="font-medium">Status:</span>{" "}
                    {hasPoliciesDocs === "yes"
                      ? "Will upload"
                      : hasPoliciesDocs === "no"
                      ? "None right now"
                      : "Not set"}
                  </div>
                  {hasPoliciesDocs === "yes" ? (
                    <div className="mt-1">
                      <span className="font-medium">Uploads:</span>{" "}
                      {policyUploads.length} file(s)
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-900">
                    IRS business master file
                  </div>
                  <button
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    onClick={() => setStep("irs")}
                  >
                    Edit
                  </button>
                </div>
                <div className="mt-2 text-sm text-slate-700">
                  <div>
                    <span className="font-medium">Permission:</span>{" "}
                    {irsPermission === "yes"
                      ? "Granted"
                      : irsPermission === "no"
                      ? "Declined"
                      : "Not set"}
                  </div>
                  {irsPermission === "yes" ? (
                    <div className="mt-1 space-y-1 text-sm">
                      <div>
                        <span className="font-medium">Filed name:</span>{" "}
                        {filedNonprofitName.trim() ? (
                          filedNonprofitName
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </div>
                      <div>
                        <span className="font-medium">EIN:</span>{" "}
                        {ein.trim() ? ein : <span className="text-slate-500">—</span>}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-900">Continue</div>
              <p className="mt-1 text-sm text-slate-700">
                Next we’ll save this context into your plan and start the section-by-section workflow.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Completion/done state for the left menu
  const doneMap: Record<StepKey, boolean> = {
    handbook:
      hasHandbook !== "unsure" && (hasHandbook === "no" || handbookUploads.length > 0),
    website:
      websitePermission !== "unset" && (websitePermission === "no" || websiteScopeOk),
    policies:
      hasPoliciesDocs !== "unset" && (hasPoliciesDocs === "no" || policyUploads.length > 0),
    irs:
      irsPermission !== "unset" &&
      (irsPermission === "no" ||
        (filedNonprofitName.trim().length >= 2 && ein.replace(/\D/g, "").length === 9)),
    review: step === "review",
  };

  const readyToMoveToWorkflow = doneMap.handbook && doneMap.website && doneMap.policies && doneMap.irs;

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

              {/* NEW: Move to handbook workflow button */}
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
                  onClick={() => {
                    // For now, go to review or directly to plan editor; your choice
                    // This could also call submitContext later once wired
                    setStep("review");
                  }}
                >
                  {readyToMoveToWorkflow ? "Start handbook workflow" : "Complete steps to continue"}
                </button>

                {readyToMoveToWorkflow ? (
                  <div className="mt-2 text-xs text-success-500">
                    ✓ Ready
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-900">Security note</div>
                <p className="mt-1 text-xs text-slate-600">
                  Your organization’s data stays isolated to your workspace. We only use what you provide and the permissions you grant.
                </p>
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
                        if (!planId) return;
                        router.push(
                          `/handbook/crafter/template?planId=${encodeURIComponent(planId)}`
                        );
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

     