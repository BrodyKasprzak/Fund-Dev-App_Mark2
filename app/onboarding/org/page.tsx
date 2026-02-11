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
  const { user, loading, setActiveOrgId, authedFetch } = useAuth();

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
    if (!loading && !user) router.push("/login");
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

    if (String(numEmployees ?? "").trim().length > 0 && Number.isNaN(parsedEmployees)) {
      setError("Number of employees must be a valid number.");
      return;
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
      // Important: create-org should NOT require x-org-id (no org yet),
      // so use fetch (or authedFetch only if it does not force x-org-id).
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
          numEmployees: String(numEmployees ?? "").trim().length > 0 ? parsedEmployees : null,
          foundedYear: trimmedFoundedYear || null,
          websiteUrl: hasWebsite ? trimmedUrl : null,
          websiteConsent: hasWebsite ? true : false,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || "Failed to create organization");
      }

      const json = await res.json();

      // ✅ NEW: set active org via AuthContext (persists to localStorage inside context)
      setActiveOrgId(json.orgId);

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
                      className={
                        hasWebsite
                          ? "text-sm text-slate-700 cursor-pointer"
                          : "text-sm text-slate-400"
                      }
                    >
                      I give permission to view{" "}
                      <span className="font-semibold">publicly available</span> information on my
                      organization's website
                    </label>
                  </div>
                  {!hasWebsite && (
                    <p className="mt-2 text-xs text-slate-500 ml-7">
                      Add a website URL to enable this option
                    </p>
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


