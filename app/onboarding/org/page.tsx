// fund-dev-app/app/onboarding/org/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

function isValidHttpUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidYear(y: string) {
  if (!/^\d{4}$/.test(y)) return false;
  const year = Number(y);
  const now = new Date().getFullYear();
  return year >= 1600 && year <= now;
}

export default function OrgOnboardingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [orgName, setOrgName] = useState("");
  const [mission, setMission] = useState("");
  const [homeState, setHomeState] = useState("");
  const [taxStatus, setTaxStatus] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [crm, setCrm] = useState("");
  const [address, setAddress] = useState("");
  const [numEmployees, setNumEmployees] = useState<string>("");
  const [foundedYear, setFoundedYear] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteConsent, setWebsiteConsent] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  const trimmedOrg = useMemo(() => orgName.trim(), [orgName]);
  const trimmedUrl = useMemo(() => websiteUrl.trim(), [websiteUrl]);
  const hasWebsite = trimmedUrl.length > 0;

  const trimmedAddress = useMemo(() => address.trim(), [address]);
  const trimmedFoundedYear = useMemo(() => foundedYear.trim(), [foundedYear]);

  const parsedEmployees = useMemo(() => {
    const s = String(numEmployees ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.floor(n);
  }, [numEmployees]);

  async function handleCreateOrg(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!user) {
      setError("You must be logged in to create an organization.");
      return;
    }

    if (!trimmedOrg) {
      setError("Organization name is required.");
      return;
    }

    if (trimmedFoundedYear && !isValidYear(trimmedFoundedYear)) {
      setError("Founded year must be a valid 4-digit year (e.g., 2012).");
      return;
    }

    if (String(numEmployees ?? "").trim().length > 0) {
      if (Number.isNaN(parsedEmployees)) {
        setError("Number of employees must be a valid number.");
        return;
      }
    }

    if (hasWebsite) {
      if (!isValidHttpUrl(trimmedUrl)) {
        setError("Website URL must be a valid http(s) URL (e.g., https://yourorg.org).");
        return;
      }
      if (!websiteConsent) {
        setError("Please grant permission to view public information on your website.");
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();

      const res = await fetch("/api/create-org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          orgName: trimmedOrg,
          mission: mission.trim() || null,
          homeState: homeState.trim() || null,
          taxStatus: taxStatus.trim() || null,
          fiscalYear: fiscalYear.trim() || null,
          crm: crm.trim() || null,
          address: trimmedAddress || null,
          numEmployees:
            String(numEmployees ?? "").trim().length > 0 ? parsedEmployees : null,
          foundedYear: trimmedFoundedYear || null,
          websiteUrl: hasWebsite ? trimmedUrl : null,
          websiteConsent: hasWebsite ? true : false,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || "Failed to create organization");
      }

      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message ?? "Failed to create organization.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-6">Loading...</p>;
  if (!user) return null;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-50 p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex px-6 py-4 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 mb-4 shadow-lg">
            <span className="text-xl font-bold text-white whitespace-nowrap">PurposeFramework</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Set up your organization</h1>
          <p className="text-slate-600">Create your workspace for building fundraising documents</p>
        </div>

        {/* Main Form Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
          <form onSubmit={handleCreateOrg} className="space-y-6">
            {/* Core org info */}
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50/30 to-primary-50/30 p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-2 w-2 rounded-full bg-gradient-to-r from-primary-500 to-accent-400"></div>
                <div className="text-sm font-bold text-slate-900">Organization details</div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Organization name <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g., Friends of FoCo Parks"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Mission statement <span className="text-slate-500">(optional)</span>
                  </label>
                  <textarea
                    className="min-h-[110px] w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition resize-none"
                    value={mission}
                    onChange={(e) => setMission(e.target.value)}
                    placeholder="1–2 sentences describing your organization's mission"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Primary state <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                      value={homeState}
                      onChange={(e) => setHomeState(e.target.value)}
                      placeholder="e.g., Colorado"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Tax status <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                      value={taxStatus}
                      onChange={(e) => setTaxStatus(e.target.value)}
                      placeholder="e.g., 501(c)(3)"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Fiscal year <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                      value={fiscalYear}
                      onChange={(e) => setFiscalYear(e.target.value)}
                      placeholder="e.g., Jan–Dec or Jul–Jun"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      CRM system <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                      value={crm}
                      onChange={(e) => setCrm(e.target.value)}
                      placeholder="e.g., Bloomerang, Salesforce"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Address <span className="text-slate-500">(optional)</span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Street, City, State, ZIP"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Employees <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                      value={numEmployees}
                      onChange={(e) => setNumEmployees(e.target.value)}
                      placeholder="e.g., 12"
                      inputMode="numeric"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Year founded <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                      value={foundedYear}
                      onChange={(e) => setFoundedYear(e.target.value)}
                      placeholder="e.g., 2012"
                      inputMode="numeric"
                      maxLength={4}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Website section */}
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50/30 to-primary-50/30 p-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-2 w-2 rounded-full bg-gradient-to-r from-accent-400 to-primary-500"></div>
                <div className="text-sm font-bold text-slate-900">Website (optional)</div>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                The AI can use public information from your website to ask fewer questions
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Website URL
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                    value={websiteUrl}
                    onChange={(e) => {
                      setWebsiteUrl(e.target.value);
                      if (e.target.value.trim().length === 0) setWebsiteConsent(false);
                    }}
                    placeholder="https://yourorg.org"
                    type="url"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Include <span className="font-mono text-primary-500">https://</span>
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="website-consent"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-500 focus:ring-primary-500"
                      checked={websiteConsent}
                      disabled={!hasWebsite}
                      onChange={(e) => setWebsiteConsent(e.target.checked)}
                    />
                    <label 
                      htmlFor="website-consent"
                      className={hasWebsite ? "text-sm text-slate-700 cursor-pointer" : "text-sm text-slate-400"}
                    >
                      I give permission to view <span className="font-semibold">publicly available</span> information on my organization's website
                    </label>
                  </div>
                  {!hasWebsite && (
                    <p className="mt-2 text-xs text-slate-500 ml-7">Add a website URL to enable this option</p>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
            )}

            <button
              className="w-full bg-gradient-to-r from-primary-500 to-accent-400 hover:from-primary-600 hover:to-primary-500 text-white font-semibold rounded-xl px-4 py-3 transition shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 disabled:opacity-60 disabled:cursor-not-allowed"
              type="submit"
              disabled={saving || !trimmedOrg || (hasWebsite && !websiteConsent)}
            >
              {saving ? "Creating workspace..." : "Create organization"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Your information is secure and private
        </p>
      </div>
    </main>
  );
}




// // fund-dev-app/app/onboarding/org/page.tsx
// "use client";

// import { useEffect, useMemo, useState } from "react";
// import { useRouter } from "next/navigation";
// import { useAuth } from "@/lib/AuthContext";

// function isValidHttpUrl(url: string) {
//   try {
//     const u = new URL(url);
//     return u.protocol === "http:" || u.protocol === "https:";
//   } catch {
//     return false;
//   }
// }

// export default function OrgOnboardingPage() {
//   const router = useRouter();
//   const { user, loading } = useAuth();

//   const [orgName, setOrgName] = useState("");
//   const [websiteUrl, setWebsiteUrl] = useState("");
//   const [websiteConsent, setWebsiteConsent] = useState(false);

//   const [saving, setSaving] = useState(false);
//   const [error, setError] = useState<string | null>(null);

//   // Protect the route
//   useEffect(() => {
//     if (!loading && !user) {
//       router.push("/login");
//     }
//   }, [user, loading, router]);

//   const trimmedOrg = useMemo(() => orgName.trim(), [orgName]);
//   const trimmedUrl = useMemo(() => websiteUrl.trim(), [websiteUrl]);
//   const hasWebsite = trimmedUrl.length > 0;

//   async function handleCreateOrg(e: React.FormEvent<HTMLFormElement>) {
//     e.preventDefault();

//     if (!user) {
//       setError("You must be logged in to create an organization.");
//       return;
//     }

//     if (!trimmedOrg) {
//       setError("Organization name is required.");
//       return;
//     }

//     // Website is optional, but if provided must be valid and must have consent
//     if (hasWebsite) {
//       if (!isValidHttpUrl(trimmedUrl)) {
//         setError("Website URL must be a valid http(s) URL (e.g., https://yourorg.org).");
//         return;
//       }
//       if (!websiteConsent) {
//         setError("Please grant permission to view public information on your website.");
//         return;
//       }
//     }

//     setSaving(true);
//     setError(null);

//     try {
//       const idToken = await user.getIdToken();

//       const res = await fetch("/api/create-org", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${idToken}`,
//         },
//         body: JSON.stringify({
//           orgName: trimmedOrg,
//           websiteUrl: hasWebsite ? trimmedUrl : null,
//           websiteConsent: hasWebsite ? true : false,
//         }),
//       });

//       if (!res.ok) {
//         const body = await res.text();
//         throw new Error(body || "Failed to create organization");
//       }

//       // After org workspace is created, go to dashboard (or wherever you route next)
//       router.push("/dashboard");
//     } catch (err: any) {
//       setError(err?.message ?? "Failed to create organization.");
//     } finally {
//       setSaving(false);
//     }
//   }

//   if (loading) return <p className="p-6">Loading...</p>;
//   if (!user) return null;

//   return (
//     <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
//       <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
//         <h1 className="text-2xl font-semibold text-slate-900">Create your organization</h1>
//         <p className="mt-1 text-sm text-slate-600">
//           This sets up your workspace for building your Fund Development Handbook.
//         </p>

//         <form onSubmit={handleCreateOrg} className="mt-5 space-y-4">
//           <div className="space-y-1">
//             <label className="text-sm font-medium text-slate-900">Organization name</label>
//             <input
//               className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//               value={orgName}
//               onChange={(e) => setOrgName(e.target.value)}
//               placeholder="e.g., Friends of FoCo Parks"
//               required
//             />
//           </div>

//           <div className="space-y-1">
//             <label className="text-sm font-medium text-slate-900">
//               Website URL <span className="text-slate-500">(optional)</span>
//             </label>
//             <input
//               className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//               value={websiteUrl}
//               onChange={(e) => {
//                 setWebsiteUrl(e.target.value);
//                 // If they clear the URL, clear consent too.
//                 if (e.target.value.trim().length === 0) setWebsiteConsent(false);
//               }}
//               placeholder="https://yourorg.org"
//               type="url"
//             />
//             <p className="text-xs text-slate-600">
//               If you provide a website, we can use public information to reduce the number of questions we ask.
//             </p>
//           </div>

//           {/* Permission / consent */}
//           <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
//             <div className="text-sm font-semibold text-slate-900">Permission</div>
//             <p className="mt-1 text-sm text-slate-700">
//               If you add a website, we’ll only use <span className="font-medium">publicly available</span> information
//               from that site to help draft your handbook.
//             </p>

//             <label className="mt-3 flex items-start gap-3">
//               <input
//                 type="checkbox"
//                 className="mt-1"
//                 checked={websiteConsent}
//                 disabled={!hasWebsite}
//                 onChange={(e) => setWebsiteConsent(e.target.checked)}
//               />
//               <span className={hasWebsite ? "text-sm text-slate-800" : "text-sm text-slate-400"}>
//                 I give permission for the app to view public information on my organization’s website.
//               </span>
//             </label>

//             {!hasWebsite ? (
//               <div className="mt-2 text-xs text-slate-500">Add a website URL to enable this option.</div>
//             ) : null}
//           </div>

//           {error ? <p className="text-sm text-rose-600">{error}</p> : null}

//           <button
//             className="w-full rounded-xl bg-success-400 p-3 text-sm font-medium text-white hover:bg-success-500 disabled:cursor-not-allowed disabled:bg-slate-400"
//             type="submit"
//             disabled={saving || !trimmedOrg || (hasWebsite && !websiteConsent)}
//           >
//             {saving ? "Creating..." : "Create organization"}
//           </button>
//         </form>
//       </div>
//     </main>
//   );
// }

// /*"use client";

// import { useEffect, useState } from "react";
// import { useRouter } from "next/navigation";
// import { useAuth } from "@/lib/AuthContext";

// export default function OrgOnboardingPage() {
//   const router = useRouter();
//   const { user, loading } = useAuth();

//   const [orgName, setOrgName] = useState("");
//   const [websiteUrl, setWebsiteUrl] = useState("");
//   const [saving, setSaving] = useState(false);
//   const [error, setError] = useState<string | null>(null);

//   // Protect the route
//   useEffect(() => {
//     if (!loading && !user) {
//       console.log("🔒 No user, redirecting to /login");
//       router.push("/login");
//     }
//   }, [user, loading, router]);

// async function handleCreateOrg(e: React.FormEvent<HTMLFormElement>) {
//   e.preventDefault();

//   if (!user) {
//     setError("You must be logged in to create an organization.");
//     return;
//   }

//   const trimmedOrg = orgName.trim();
//   const trimmedUrl = websiteUrl.trim();

//   if (!trimmedOrg) {
//     setError("Organization name is required.");
//     return;
//   }

//   if (!/^https?:\/\//i.test(trimmedUrl)) {
//     setError("Website URL must start with https://");
//     return;
//   }

//   setSaving(true);
//   setError(null);

//   try {
//     const idToken = await user.getIdToken();

//     const res = await fetch("/api/create-org", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${idToken}`,
//       },
//       body: JSON.stringify({ orgName: trimmedOrg, websiteUrl: trimmedUrl }),
//     });

//     if (!res.ok) {
//       const body = await res.text();
//       throw new Error(body || "Failed to create organization");
//     }

//     router.push("/dashboard");
//   } catch (err: any) {
//     setError(err.message ?? "Failed to create organization.");
//   } finally {
//     setSaving(false);
//   }
// }

//   if (loading) {
//     return <p className="p-6">Loading...</p>;
//   }

//   if (!user) return null;

//   return (
//     <main className="min-h-screen flex items-center justify-center p-6">
//       <div className="w-full max-w-lg border rounded-xl p-6">
//         <h1 className="text-2xl font-semibold">Create your organization</h1>
//         <p className="text-sm opacity-80 mt-1">
//           This sets up your workspace for building a fund development plan.
//         </p>

//         <form
//           onSubmit={handleCreateOrg}
//           onSubmitCapture={() => console.log("✅ FORM SUBMIT CAPTURED")}
//           className="space-y-3 mt-5"
//         >
//           <div className="space-y-1">
//             <label className="text-sm">Organization name</label>
//             <input
//               className="w-full border rounded-md p-2"
//               value={orgName}
//               onChange={(e) => setOrgName(e.target.value)}
//               placeholder="e.g., Friends of FoCo Parks"
//               required
//             />
//           </div>

//           <div className="space-y-1">
//             <label className="text-sm">Website URL</label>
//             <input
//               className="w-full border rounded-md p-2"
//               value={websiteUrl}
//               onChange={(e) => setWebsiteUrl(e.target.value)}
//               placeholder="https://yourorg.org"
//               type="url"
//               required
//             />
//             <p className="text-xs opacity-70">
//               Tip: include <span className="font-mono">https://</span> (required
//               by many browsers for URL fields).
//             </p>
//           </div>

//           {error && <p className="text-sm text-red-600">{error}</p>}

//           <button
//             className="w-full border rounded-md p-2"
//             type="submit"
//             disabled={saving || loading || !user}
//             onClick={() => console.log("✅ BUTTON CLICKED")}
//           >
//             {saving ? "Creating..." : "Create organization"}
//           </button>
//         </form>
//       </div>
//     </main>
//   );
// } */

