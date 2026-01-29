"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";

type Template = {
  key: string;
  title: string;
  description: string;
};

const TEMPLATES: Template[] = [
  {
    key: "fund_dev_handbook",
    title: "Fund Development Handbook",
    description:
      "Build your organization's fundraising framework, standards, and playbooks to support sustainable growth and continuity.",
  },
  {
    key: "annual_fund_dev_plan",
    title: "Annual Fund Development Plan",
    description:
      "Set annual revenue goals, define campaign strategy, assign ownership, and manage a month-by-month execution calendar.",
  },
  {
    key: "case_for_support",
    title: "Case for Support",
    description:
      "Develop a donor-facing narrative that communicates community need, program impact, and urgency with clarity and credibility.",
  },
  {
    key: "campaign_plan",
    title: "Campaign Plan",
    description:
      "Structure a major fundraising initiative with phases, milestones, prospect strategy, and readiness checkpoints.",
  },
  {
    key: "grant_strategy",
    title: "Grant Strategy",
    description:
      "Prioritize funders, align programs to opportunities, and maintain a grants pipeline, calendar, and submission responsibilities.",
  },
];

function PlusDivider() {
  return (
    <div className="flex justify-center py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xl leading-none text-slate-400">
        +
      </div>
    </div>
  );
}

function BoxTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold text-slate-900">{children}</div>;
}

function BoxText({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-sm text-slate-700">{children}</div>;
}

function Arrow() {
  return (
    <div className="flex items-center justify-center px-4">
      <svg
        width="54"
        height="18"
        viewBox="0 0 54 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <line x1="0" y1="9" x2="44" y2="9" stroke="#94A3B8" strokeWidth="2" />
        <path
          d="M44 3 L52 9 L44 15"
          stroke="#94A3B8"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function FlowGraphic() {
  return (
    <div className="w-full overflow-x-auto">
      {/* Center the whole flow and allow horizontal scroll on small screens */}
      <div className="min-w-[980px] flex justify-center">
        <div className="flex items-center">
          {/* LEFT: Inputs box */}
          <div className="rounded-2xl border border-primary-300 bg-white p-5 shadow-sm">
            <BoxTitle>Inputs & context</BoxTitle>

            <div className="mt-4">
              <div className="text-sm font-medium text-slate-900">
                Existing handbook (optional)
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Prior fund development handbook, drafts, or relevant strategic documents.
              </div>

              <PlusDivider />

              <div className="text-sm font-medium text-slate-900">
                Organization context
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Mission, programs, audiences served, revenue mix, and fundraising priorities.
              </div>

              <PlusDivider />

              <div className="text-sm font-medium text-slate-900">
                Policies, procedures & supporting materials
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Gift acceptance policies, stewardship standards, templates, collateral, and
                internal processes.
              </div>
            </div>
          </div>

          <Arrow />

          {/* MIDDLE: Gap-fill + Draft + AI */}
          <div className="rounded-2xl border border-primary-300 bg-white p-5 shadow-sm">
            <BoxTitle>Draft & refinement workflow</BoxTitle>

            <div className="mt-4">
              {/* GAP FILL — moved to top */}
              <div className="text-sm font-medium text-slate-900">
                Gap-fill questions
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Short prompts to clarify missing information before drafting begins.
              </div>

              <PlusDivider />

              <div className="text-sm font-medium text-slate-900">
                Draft handbook using professional framework
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Section-by-section structure aligned with fund development best practices.
              </div>

              <PlusDivider />

              <div className="text-sm font-medium text-slate-900">
                AI refinement (section-by-section)
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Improve clarity, tone, and completeness — nothing is published automatically.
              </div>
            </div>
          </div>

          <Arrow />

          {/* USER APPROVAL */}
          <div className="rounded-2xl border border-primary-300 bg-white p-5 shadow-sm">
            <BoxTitle>User review</BoxTitle>
            <BoxText>
              Review each section, request revisions, and approve formatting and structure.
            </BoxText>
          </div>

          <Arrow />

          {/* ORG APPROVAL */}
          <div className="rounded-2xl border border-primary-300 bg-white p-5 shadow-sm">
            <BoxTitle>Organization approval & publish</BoxTitle>
            <BoxText>
              Optional final sign-off before marking the handbook as approved for organizational use.
            </BoxText>
          </div>
        </div>
      </div>
    </div>
  );
}

function initialsFromName(name?: string) {
  const n = String(name ?? "").trim();
  if (!n) return "O";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "O";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase();
}

export default function ProductsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>("");

  const [handbookModalOpen, setHandbookModalOpen] = useState(false);

  // Profile popover state
  const [profileOpen, setProfileOpen] = useState(false);
  const profileBtnRef = useRef<HTMLButtonElement | null>(null);
  const profilePopoverRef = useRef<HTMLDivElement | null>(null);

  // Org name for profile display
  const [orgName, setOrgName] = useState<string>("");

  // Fetch org name on mount
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          setOrgName(String(json?.org?.name ?? json?.orgName ?? "").trim());
        }
      } catch {
        // Ignore errors
      }
    })();
  }, [user]);

  // Close profile popover on outside click / ESC
  useEffect(() => {
    if (!profileOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileOpen(false);
    }

    function onMouseDown(e: MouseEvent) {
      const btn = profileBtnRef.current;
      const pop = profilePopoverRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if (btn && btn.contains(target)) return;
      if (pop && pop.contains(target)) return;
      setProfileOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [profileOpen]);

  if (!loading && !user) {
    router.push("/login");
    return null;
  }

  async function createPlan(templateType: string) {
    setError("");
    setCreating(true);

    try {
      if (!user) {
        router.push("/login");
        return null;
      }

      const idToken = await user.getIdToken();

      const res = await fetch("/api/plans/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ templateType }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create plan");

      return data.planId as string;
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      return null;
    } finally {
      setCreating(false);
    }
  }

  function handleTemplateClick(t: Template) {
    if (t.key === "fund_dev_handbook") {
      setError("");
      setHandbookModalOpen(true);
      return;
    }

    (async () => {
      const planId = await createPlan(t.key);
      if (planId) router.push(`/plans/${encodeURIComponent(planId)}`);
    })();
  }

  async function handleLetsBeginHandbook() {
    const planId = await createPlan("fund_dev_handbook");
    if (!planId) return;

    router.push(`/handbook/crafter?planId=${encodeURIComponent(planId)}`);
  }

  const orgDisplayName = (orgName || "").trim() || "Your organization";
  const avatarText = initialsFromName(orgDisplayName);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Profile icon in upper right */}
      <div className="absolute top-6 right-6 z-10">
        <div className="relative">
          <button
            ref={profileBtnRef}
            type="button"
            aria-label="Open profile"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white shadow-sm hover:bg-primary-700"
            onClick={() => setProfileOpen((v) => !v)}
          >
            {avatarText}
          </button>

          {profileOpen ? (
            <div
              ref={profilePopoverRef}
              className="absolute right-0 z-50 mt-2 w-[340px] rounded-2xl border border-slate-200 bg-white p-4 shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{orgDisplayName}</div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    Signed in as <span className="font-medium">{user?.email ?? "Unknown"}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  onClick={() => setProfileOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
                  onClick={() => {
                    setProfileOpen(false);
                    router.push("/dashboard");
                  }}
                >
                  Return home
                </button>
                <button
                  type="button"
                  className="w-full rounded-md bg-slate-900 px-3 py-2 text-left text-sm text-white hover:bg-slate-800"
                  onClick={async () => {
                    await signOut(auth);
                    router.push("/login");
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold text-slate-900">Products</h1>
        <p className="mt-2 text-slate-600">
          Start creating plans and strategic documents for your organization.
        </p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => handleTemplateClick(t)}
              disabled={creating}
              className="text-left rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-slate-900">
                    {t.title}
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {t.description}
                  </div>
                </div>
                <div className="text-sm text-slate-500">
                  {creating ? "Working..." : "Open →"}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Fund Development Handbook Modal */}
      {handbookModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !creating && setHandbookModalOpen(false)}
          />

          {/* Modal card */}
          <div className="relative w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Fund Development Handbook — AI Helper
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  A guided workflow to draft, refine, and approve a consultant-grade handbook—scoped
                  to your organization.
                </p>
              </div>

              <button
                className="border border-slate-200 rounded-md px-3 py-1 text-slate-800 hover:bg-slate-100 disabled:opacity-60"
                onClick={() => setHandbookModalOpen(false)}
                type="button"
                disabled={creating}
              >
                Close
              </button>
            </div>

            <div className="mt-6">
              <FlowGraphic />
              <p className="mt-4 text-xs text-slate-500">
                Your content remains inside your organization's workspace. Drafts are not finalized
                without review and approval.
              </p>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={creating}
                onClick={handleLetsBeginHandbook}
              >
                {creating ? "Starting..." : "Let's begin"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




// "use client";

// import { useRouter } from "next/navigation";
// import { useState } from "react";
// import { useAuth } from "@/lib/AuthContext";

// type Template = {
//   key: string;
//   title: string;
//   description: string;
// };

// const TEMPLATES: Template[] = [
//   {
//     key: "fund_dev_handbook",
//     title: "Fund Development Handbook",
//     description:
//       "Build your organization’s fundraising framework, standards, and playbooks to support sustainable growth and continuity.",
//   },
//   {
//     key: "annual_fund_dev_plan",
//     title: "Annual Fund Development Plan",
//     description:
//       "Set annual revenue goals, define campaign strategy, assign ownership, and manage a month-by-month execution calendar.",
//   },
//   {
//     key: "case_for_support",
//     title: "Case for Support",
//     description:
//       "Develop a donor-facing narrative that communicates community need, program impact, and urgency with clarity and credibility.",
//   },
//   {
//     key: "campaign_plan",
//     title: "Campaign Plan",
//     description:
//       "Structure a major fundraising initiative with phases, milestones, prospect strategy, and readiness checkpoints.",
//   },
//   {
//     key: "grant_strategy",
//     title: "Grant Strategy",
//     description:
//       "Prioritize funders, align programs to opportunities, and maintain a grants pipeline, calendar, and submission responsibilities.",
//   },
// ];

// function PlusDivider() {
//   return (
//     <div className="flex justify-center py-3">
//       <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xl leading-none text-slate-400">
//         +
//       </div>
//     </div>
//   );
// }

// function BoxTitle({ children }: { children: React.ReactNode }) {
//   return <div className="text-sm font-semibold text-slate-900">{children}</div>;
// }

// function BoxText({ children }: { children: React.ReactNode }) {
//   return <div className="mt-1 text-sm text-slate-700">{children}</div>;
// }

// function Arrow() {
//   return (
//     <div className="flex items-center justify-center px-4">
//       <svg
//         width="54"
//         height="18"
//         viewBox="0 0 54 18"
//         fill="none"
//         xmlns="http://www.w3.org/2000/svg"
//         aria-hidden
//       >
//         <line x1="0" y1="9" x2="44" y2="9" stroke="#94A3B8" strokeWidth="2" />
//         <path
//           d="M44 3 L52 9 L44 15"
//           stroke="#94A3B8"
//           strokeWidth="2"
//           fill="none"
//           strokeLinejoin="round"
//         />
//       </svg>
//     </div>
//   );
// }

// function FlowGraphic() {
//   return (
//     <div className="w-full overflow-x-auto">
//       {/* Center the whole flow and allow horizontal scroll on small screens */}
//       <div className="min-w-[980px] flex justify-center">
//         <div className="flex items-center">
//           {/* LEFT: Inputs box */}
//           <div className="rounded-2xl border border-primary-300 bg-white p-5 shadow-sm">
//             <BoxTitle>Inputs & context</BoxTitle>

//             <div className="mt-4">
//               <div className="text-sm font-medium text-slate-900">
//                 Existing handbook (optional)
//               </div>
//               <div className="mt-1 text-sm text-slate-700">
//                 Prior fund development handbook, drafts, or relevant strategic documents.
//               </div>

//               <PlusDivider />

//               <div className="text-sm font-medium text-slate-900">
//                 Organization context
//               </div>
//               <div className="mt-1 text-sm text-slate-700">
//                 Mission, programs, audiences served, revenue mix, and fundraising priorities.
//               </div>

//               <PlusDivider />

//               <div className="text-sm font-medium text-slate-900">
//                 Policies, procedures & supporting materials
//               </div>
//               <div className="mt-1 text-sm text-slate-700">
//                 Gift acceptance policies, stewardship standards, templates, collateral, and
//                 internal processes.
//               </div>
//             </div>
//           </div>

//           <Arrow />

//           {/* MIDDLE: Gap-fill + Draft + AI */}
//           <div className="rounded-2xl border border-primary-300 bg-white p-5 shadow-sm">
//             <BoxTitle>Draft & refinement workflow</BoxTitle>

//             <div className="mt-4">
//               {/* GAP FILL — moved to top */}
//               <div className="text-sm font-medium text-slate-900">
//                 Gap-fill questions
//               </div>
//               <div className="mt-1 text-sm text-slate-700">
//                 Short prompts to clarify missing information before drafting begins.
//               </div>

//               <PlusDivider />

//               <div className="text-sm font-medium text-slate-900">
//                 Draft handbook using professional framework
//               </div>
//               <div className="mt-1 text-sm text-slate-700">
//                 Section-by-section structure aligned with fund development best practices.
//               </div>

//               <PlusDivider />

//               <div className="text-sm font-medium text-slate-900">
//                 AI refinement (section-by-section)
//               </div>
//               <div className="mt-1 text-sm text-slate-700">
//                 Improve clarity, tone, and completeness — nothing is published automatically.
//               </div>
//             </div>
//           </div>

//           <Arrow />

//           {/* USER APPROVAL */}
//           <div className="rounded-2xl border border-primary-300 bg-white p-5 shadow-sm">
//             <BoxTitle>User review</BoxTitle>
//             <BoxText>
//               Review each section, request revisions, and approve formatting and structure.
//             </BoxText>
//           </div>

//           <Arrow />

//           {/* ORG APPROVAL */}
//           <div className="rounded-2xl border border-primary-300 bg-white p-5 shadow-sm">
//             <BoxTitle>Organization approval & publish</BoxTitle>
//             <BoxText>
//               Optional final sign-off before marking the handbook as approved for organizational use.
//             </BoxText>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// export default function ProductsPage() {
//   const router = useRouter();
//   const { user, loading } = useAuth();

//   const [creating, setCreating] = useState(false);
//   const [error, setError] = useState<string>("");

//   const [handbookModalOpen, setHandbookModalOpen] = useState(false);

//   // ✅ Auth guard (prevents weird behavior while loading)
//   if (!loading && !user) {
//     router.push("/login");
//     return null;
//   }

//   async function createPlan(templateType: string) {
//     setError("");
//     setCreating(true);

//     try {
//       if (!user) {
//         router.push("/login");
//         return null;
//       }

//       const idToken = await user.getIdToken();

//       const res = await fetch("/api/plans/create", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${idToken}`,
//         },
//         body: JSON.stringify({ templateType }),
//       });

//       const data = await res.json();
//       if (!res.ok) throw new Error(data?.error || "Failed to create plan");

//       return data.planId as string;
//     } catch (e: any) {
//       setError(e?.message ?? "Something went wrong");
//       return null;
//     } finally {
//       setCreating(false);
//     }
//   }

//   function handleTemplateClick(t: Template) {
//     if (t.key === "fund_dev_handbook") {
//       setError("");
//       setHandbookModalOpen(true);
//       return;
//     }

//     (async () => {
//       const planId = await createPlan(t.key);
//       if (planId) router.push(`/plans/${encodeURIComponent(planId)}`);
//     })();
//   }

//   // ✅ This is the ONLY important routing change:
//   // It routes to /handbook/crafter (NOT /fund-dev-handbook/crafter)
//   async function handleLetsBeginHandbook() {
//     const planId = await createPlan("fund_dev_handbook");
//     if (!planId) return;

//     router.push(`/handbook/crafter?planId=${encodeURIComponent(planId)}`);
//   }

//   return (
//     <div className="min-h-screen bg-slate-50">
//       <div className="mx-auto max-w-5xl px-6 py-10">
//         <h1 className="text-3xl font-semibold text-slate-900">Products</h1>
//         <p className="mt-2 text-slate-600">
//           Start creating plans and strategic documents for your organization.
//         </p>

//         {error ? (
//           <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
//             {error}
//           </div>
//         ) : null}

//         <div className="mt-8 grid gap-4 sm:grid-cols-2">
//           {TEMPLATES.map((t) => (
//             <button
//               key={t.key}
//               onClick={() => handleTemplateClick(t)}
//               disabled={creating}
//               className="text-left rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow disabled:opacity-60"
//             >
//               <div className="flex items-start justify-between gap-3">
//                 <div>
//                   <div className="text-lg font-semibold text-slate-900">
//                     {t.title}
//                   </div>
//                   <div className="mt-2 text-sm text-slate-600">
//                     {t.description}
//                   </div>
//                 </div>
//                 <div className="text-sm text-slate-500">
//                   {creating ? "Working..." : "Open →"}
//                 </div>
//               </div>
//             </button>
//           ))}
//         </div>
//       </div>

//       {/* Fund Development Handbook Modal */}
//       {handbookModalOpen && (
//         <div
//           className="fixed inset-0 z-50 flex items-center justify-center p-4"
//           role="dialog"
//           aria-modal="true"
//         >
//           {/* Backdrop */}
//           <div
//             className="absolute inset-0 bg-black/40"
//             onClick={() => !creating && setHandbookModalOpen(false)}
//           />

//           {/* Modal card */}
//           <div className="relative w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
//             <div className="flex items-start justify-between gap-4">
//               <div>
//                 <h2 className="text-xl font-semibold text-slate-900">
//                   Fund Development Handbook — AI Helper
//                 </h2>
//                 <p className="text-sm text-slate-600 mt-1">
//                   A guided workflow to draft, refine, and approve a consultant-grade handbook—scoped
//                   to your organization.
//                 </p>
//               </div>

//               <button
//                 className="border border-slate-200 rounded-md px-3 py-1 text-slate-800 hover:bg-slate-100 disabled:opacity-60"
//                 onClick={() => setHandbookModalOpen(false)}
//                 type="button"
//                 disabled={creating}
//               >
//                 Close
//               </button>
//             </div>

//             <div className="mt-6">
//               <FlowGraphic />
//               <p className="mt-4 text-xs text-slate-500">
//                 Your content remains inside your organization’s workspace. Drafts are not finalized
//                 without review and approval.
//               </p>
//             </div>

//             <div className="mt-6 flex items-center justify-end gap-3">
//               <button
//                 type="button"
//                 className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-60"
//                 disabled={creating}
//                 onClick={handleLetsBeginHandbook}
//               >
//                 {creating ? "Starting..." : "Let’s begin"}
//               </button>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }


