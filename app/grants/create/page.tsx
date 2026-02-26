"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

type GrantForm = {
  funderName: string;
  opportunityName: string;
  opportunityType: string;
  deadline: string;
  amountRequest: string;
  matchRequirement: string;
  eligibilitySummary: string;
  priorityAlignment: string;
  geographicScope: string;
  projectTitle: string;
  projectSummary: string;
  targetPopulation: string;
  outcomes: string;
  evaluationPlan: string;
  totalProjectBudget: string;
  requestedGrantBudget: string;
  indirectCostRate: string;
  complianceNotes: string;
  projectLead: string;
  financeOwner: string;
  executiveReviewer: string;
  draftDueDate: string;
  reviewDueDate: string;
  submissionDate: string;
  attachments: string[];
  riskNotes: string;
};

const ATTACHMENT_OPTIONS = [
  { key: "irs_letter", label: "IRS determination letter" },
  { key: "board_list", label: "Board roster" },
  { key: "financials", label: "Recent audited financial statements" },
  { key: "operating_budget", label: "Current operating budget" },
  { key: "project_budget", label: "Project budget and budget narrative" },
  { key: "logic_model", label: "Logic model or results framework" },
  { key: "letters_of_support", label: "Letters of support or partnership MOUs" },
];

function initialsFromName(name?: string) {
  const n = String(name ?? "").trim();
  if (!n) return "O";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "O";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase();
}

export default function GrantCreationPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [checkingOrg, setCheckingOrg] = useState(true);
  const [saveMessage, setSaveMessage] = useState("");

  const [form, setForm] = useState<GrantForm>({
    funderName: "",
    opportunityName: "",
    opportunityType: "Foundation",
    deadline: "",
    amountRequest: "",
    matchRequirement: "",
    eligibilitySummary: "",
    priorityAlignment: "",
    geographicScope: "",
    projectTitle: "",
    projectSummary: "",
    targetPopulation: "",
    outcomes: "",
    evaluationPlan: "",
    totalProjectBudget: "",
    requestedGrantBudget: "",
    indirectCostRate: "",
    complianceNotes: "",
    projectLead: "",
    financeOwner: "",
    executiveReviewer: "",
    draftDueDate: "",
    reviewDueDate: "",
    submissionDate: "",
    attachments: [],
    riskNotes: "",
  });

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, router, user]);

  useEffect(() => {
    async function resolveOrg() {
      if (loading) return;
      if (!user) {
        setCheckingOrg(false);
        return;
      }

      setCheckingOrg(true);
      try {
        const stored = window.localStorage.getItem("pf_active_org");
        const candidate = typeof stored === "string" ? stored.trim() : "";
        if (!candidate) {
          router.push(`/org-picker?next=${encodeURIComponent("/grants/create")}`);
          return;
        }

        const memberRef = doc(db, "organizations", candidate, "members", user.uid);
        const memberSnap = await getDoc(memberRef);
        if (!memberSnap.exists()) {
          window.localStorage.removeItem("pf_active_org");
          router.push(`/org-picker?next=${encodeURIComponent("/grants/create")}`);
          return;
        }

        setOrgId(candidate);

        const orgRef = doc(db, "organizations", candidate);
        const orgSnap = await getDoc(orgRef);
        if (orgSnap.exists()) {
          const data = orgSnap.data() as { name?: string };
          setOrgName(String(data?.name ?? "").trim());
        } else {
          setOrgName("");
        }
      } catch {
        router.push(`/org-picker?next=${encodeURIComponent("/grants/create")}`);
      } finally {
        setCheckingOrg(false);
      }
    }

    void resolveOrg();
  }, [loading, router, user]);

  function updateField<K extends keyof GrantForm>(key: K, value: GrantForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleAttachment(key: string) {
    setForm((prev) => {
      const exists = prev.attachments.includes(key);
      const nextAttachments = exists
        ? prev.attachments.filter((item) => item !== key)
        : [...prev.attachments, key];
      return { ...prev, attachments: nextAttachments };
    });
  }

  const readinessChecks = useMemo(
    () => [
      {
        label: "Opportunity details are complete",
        met: Boolean(form.funderName && form.opportunityName && form.deadline),
      },
      {
        label: "Eligibility and alignment are documented",
        met: Boolean(form.eligibilitySummary && form.priorityAlignment),
      },
      {
        label: "Program outcomes and evaluation are defined",
        met: Boolean(form.projectSummary && form.outcomes && form.evaluationPlan),
      },
      {
        label: "Budget assumptions are entered",
        met: Boolean(form.totalProjectBudget && form.requestedGrantBudget),
      },
      {
        label: "Internal owners and review dates are assigned",
        met: Boolean(form.projectLead && form.financeOwner && form.reviewDueDate),
      },
      {
        label: "Core attachments are selected",
        met: form.attachments.length > 0,
      },
    ],
    [form],
  );

  const completedChecks = readinessChecks.filter((item) => item.met).length;
  const readinessPercent = Math.round((completedChecks / readinessChecks.length) * 100);
  const organizationName = orgName.trim() || "Your organization";
  const avatarText = initialsFromName(organizationName);

  if (loading || checkingOrg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm font-semibold text-slate-800">Loading workspace...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            onClick={() => router.push("/products")}
          >
            Back to products
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white">
              {avatarText}
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-900">{organizationName}</div>
              <div className="text-xs text-slate-600">Workspace {orgId ?? "-"}</div>
            </div>
            <button
              type="button"
              className="ml-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              onClick={async () => {
                await signOut(auth);
                router.push("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-semibold text-slate-900">Grant Creation Workspace</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">
            Use this page to set up each grant with clear ownership, realistic timelines, and
            complete requirements before drafting and submission.
          </p>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[2fr,1fr]">
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              setSaveMessage("Draft saved locally. Submission workflow can be wired next.");
            }}
          >
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">1. Opportunity Profile</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-slate-700">
                  Funder name
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.funderName}
                    onChange={(e) => updateField("funderName", e.target.value)}
                    placeholder="Example Foundation"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Opportunity title
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.opportunityName}
                    onChange={(e) => updateField("opportunityName", e.target.value)}
                    placeholder="2026 Community Impact Grant"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Opportunity type
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.opportunityType}
                    onChange={(e) => updateField("opportunityType", e.target.value)}
                  >
                    <option>Foundation</option>
                    <option>Government</option>
                    <option>Corporate</option>
                    <option>Family Office</option>
                    <option>Other</option>
                  </select>
                </label>
                <label className="text-sm text-slate-700">
                  External deadline
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.deadline}
                    onChange={(e) => updateField("deadline", e.target.value)}
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Requested amount
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.amountRequest}
                    onChange={(e) => updateField("amountRequest", e.target.value)}
                    placeholder="$50,000"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Match requirement
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.matchRequirement}
                    onChange={(e) => updateField("matchRequirement", e.target.value)}
                    placeholder="None or specify percentage/source"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">2. Eligibility and Strategic Fit</h2>
              <div className="mt-4 grid gap-4">
                <label className="text-sm text-slate-700">
                  Eligibility summary
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.eligibilitySummary}
                    onChange={(e) => updateField("eligibilitySummary", e.target.value)}
                    placeholder="Confirm applicant type, geography, and funding restrictions."
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Alignment to organizational priorities
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.priorityAlignment}
                    onChange={(e) => updateField("priorityAlignment", e.target.value)}
                    placeholder="State how this opportunity advances current strategic goals."
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Geographic scope and service area
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.geographicScope}
                    onChange={(e) => updateField("geographicScope", e.target.value)}
                    placeholder="County, state, or region served"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">3. Program Design and Outcomes</h2>
              <div className="mt-4 grid gap-4">
                <label className="text-sm text-slate-700">
                  Project title
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.projectTitle}
                    onChange={(e) => updateField("projectTitle", e.target.value)}
                    placeholder="After-School Mentoring Expansion"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Problem statement and project summary
                  <textarea
                    rows={4}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.projectSummary}
                    onChange={(e) => updateField("projectSummary", e.target.value)}
                    placeholder="Describe community need, intervention model, and why this project is timely."
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Target population
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.targetPopulation}
                    onChange={(e) => updateField("targetPopulation", e.target.value)}
                    placeholder="Who will benefit and how many participants will be served"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Measurable outcomes
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.outcomes}
                    onChange={(e) => updateField("outcomes", e.target.value)}
                    placeholder="Use specific outputs and outcomes with target values and timeline."
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Evaluation and reporting approach
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.evaluationPlan}
                    onChange={(e) => updateField("evaluationPlan", e.target.value)}
                    placeholder="List data sources, collection frequency, and reporting owner."
                  />
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">4. Budget and Compliance</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-slate-700">
                  Total project budget
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.totalProjectBudget}
                    onChange={(e) => updateField("totalProjectBudget", e.target.value)}
                    placeholder="$120,000"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Amount requested from funder
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.requestedGrantBudget}
                    onChange={(e) => updateField("requestedGrantBudget", e.target.value)}
                    placeholder="$50,000"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Indirect cost rate
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.indirectCostRate}
                    onChange={(e) => updateField("indirectCostRate", e.target.value)}
                    placeholder="10% MTDC or funder cap"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Compliance notes
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.complianceNotes}
                    onChange={(e) => updateField("complianceNotes", e.target.value)}
                    placeholder="Reporting frequency, payment terms, restricted costs"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">5. Team Ownership and Timeline</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-slate-700">
                  Project lead
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.projectLead}
                    onChange={(e) => updateField("projectLead", e.target.value)}
                    placeholder="Development Director"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Finance owner
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.financeOwner}
                    onChange={(e) => updateField("financeOwner", e.target.value)}
                    placeholder="Controller or Finance Manager"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Executive reviewer
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.executiveReviewer}
                    onChange={(e) => updateField("executiveReviewer", e.target.value)}
                    placeholder="CEO or Executive Director"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Internal draft due date
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.draftDueDate}
                    onChange={(e) => updateField("draftDueDate", e.target.value)}
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Internal review due date
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.reviewDueDate}
                    onChange={(e) => updateField("reviewDueDate", e.target.value)}
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Planned submission date
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                    value={form.submissionDate}
                    onChange={(e) => updateField("submissionDate", e.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">6. Required Attachments and Risks</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {ATTACHMENT_OPTIONS.map((option) => {
                  const checked = form.attachments.includes(option.key);
                  return (
                    <label
                      key={option.key}
                      className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAttachment(option.key)}
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
              <label className="mt-4 block text-sm text-slate-700">
                Risk flags and mitigation notes
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
                  value={form.riskNotes}
                  onChange={(e) => updateField("riskNotes", e.target.value)}
                  placeholder="Identify assumptions, capacity constraints, or dependencies that could impact submission quality."
                />
              </label>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Save starter draft
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                onClick={() => router.push("/products")}
              >
                Return to products
              </button>
            </div>

            {saveMessage ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {saveMessage}
              </div>
            ) : null}
          </form>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Readiness Score
              </h3>
              <div className="mt-3 text-3xl font-semibold text-slate-900">{readinessPercent}%</div>
              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-primary-600"
                  style={{ width: `${readinessPercent}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {completedChecks} of {readinessChecks.length} preparation checks complete
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {readinessChecks.map((check) => (
                  <li
                    key={check.label}
                    className={check.met ? "text-emerald-700" : "text-slate-600"}
                  >
                    {check.met ? "Complete: " : "Pending: "}
                    {check.label}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Nonprofit Best Practices
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                <li>Validate eligibility before drafting to avoid wasted staff time.</li>
                <li>Define outcomes with baseline, target, and reporting cadence.</li>
                <li>Align budget line items to proposed activities and timeline.</li>
                <li>Build at least five business days for internal compliance review.</li>
                <li>Document submission owner and final sign-off authority early.</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
