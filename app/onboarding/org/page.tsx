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
  const { user, loading, setActiveOrgId, refreshMe } = useAuth();

  const [testerAccessCode, setTesterAccessCode] = useState("");
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

  const trimmedTesterAccessCode = useMemo(() => testerAccessCode.trim(), [testerAccessCode]);
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

    if (!trimmedTesterAccessCode) {
      setError("Tester access code is required to create a workplace.");
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
      const idToken = await user.getIdToken();

      const res = await fetch("/api/create-org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          testerAccessCode: trimmedTesterAccessCode,
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
        const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
        const message =
          payload && typeof payload.error === "string" && payload.error.trim().length > 0
            ? payload.error
            : "Failed to create organization";
        throw new Error(message);
      }

      const json = await res.json();
      setActiveOrgId(json.orgId);
      await refreshMe();
      router.push("/dashboard", { scroll: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create organization.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-6">Loading...</p>;
  if (!user) return null;

  return (
    <main className="public-shell p-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-7 text-center">
          <span className="auth-brand-chip">PurposeFramework</span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Set up your organization</h1>
          <p className="mt-2 text-sm text-slate-600">
            Create your workspace for building fundraising documents.
          </p>
        </div>

        <div className="auth-card p-7">
          <form onSubmit={handleCreateOrg} className="space-y-5">
            <div className="auth-section-card p-5">
              <p className="mb-3 text-sm font-semibold text-slate-900">Tester access</p>
              <label className="field-label">
                Type in tester access code to create workplace <span className="text-rose-500">*</span>
              </label>
              <input
                className="field-input"
                value={testerAccessCode}
                onChange={(e) => setTesterAccessCode(e.target.value)}
                placeholder="Enter tester access code"
                required
              />
            </div>

            <div className="auth-section-card p-5">
              <p className="mb-3 text-sm font-semibold text-slate-900">Organization details</p>

              <div className="space-y-4">
                <div>
                  <label className="field-label">
                    Organization name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    className="field-input"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g., Friends of FoCo Parks"
                    required
                  />
                </div>

                <div>
                  <label className="field-label">
                    Mission statement <span className="text-slate-500">(optional)</span>
                  </label>
                  <textarea
                    className="field-input min-h-[110px] resize-none"
                    value={mission}
                    onChange={(e) => setMission(e.target.value)}
                    placeholder="1-2 sentences describing your organization's mission"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="field-label">
                      Primary state <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="field-input"
                      value={homeState}
                      onChange={(e) => setHomeState(e.target.value)}
                      placeholder="e.g., Colorado"
                    />
                  </div>

                  <div>
                    <label className="field-label">
                      Tax status <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="field-input"
                      value={taxStatus}
                      onChange={(e) => setTaxStatus(e.target.value)}
                      placeholder="e.g., 501(c)(3)"
                    />
                  </div>

                  <div>
                    <label className="field-label">
                      Fiscal year <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="field-input"
                      value={fiscalYear}
                      onChange={(e) => setFiscalYear(e.target.value)}
                      placeholder="e.g., Jan-Dec or Jul-Jun"
                    />
                  </div>

                  <div>
                    <label className="field-label">
                      CRM system <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="field-input"
                      value={crm}
                      onChange={(e) => setCrm(e.target.value)}
                      placeholder="e.g., Bloomerang, Salesforce"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">
                    Address <span className="text-slate-500">(optional)</span>
                  </label>
                  <input
                    className="field-input"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Street, City, State, ZIP"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="field-label">
                      Employees <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="field-input"
                      value={numEmployees}
                      onChange={(e) => setNumEmployees(e.target.value)}
                      placeholder="e.g., 12"
                      inputMode="numeric"
                    />
                  </div>

                  <div>
                    <label className="field-label">
                      Year founded <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      className="field-input"
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

            <div className="auth-section-card p-5">
              <p className="text-sm font-semibold text-slate-900">Website (optional)</p>
              <p className="mt-1 text-sm text-slate-600">
                The AI can use public information from your website to ask fewer questions.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="field-label">Website URL</label>
                  <input
                    className="field-input"
                    value={websiteUrl}
                    onChange={(e) => {
                      setWebsiteUrl(e.target.value);
                      if (e.target.value.trim().length === 0) setWebsiteConsent(false);
                    }}
                    placeholder="https://yourorg.org"
                    type="url"
                  />
                  <p className="field-help">Include https://</p>
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
                      className={hasWebsite ? "cursor-pointer text-sm text-slate-700" : "text-sm text-slate-400"}
                    >
                      I give permission to view <span className="font-semibold">publicly available</span>{" "}
                      information on my organization&apos;s website.
                    </label>
                  </div>
                  {!hasWebsite ? (
                    <p className="ml-7 mt-2 text-xs text-slate-500">Add a website URL to enable this option.</p>
                  ) : null}
                </div>
              </div>
            </div>

            {error ? <div className="status-box status-box-error">{error}</div> : null}

            <button
              className="btn-primary w-full px-4 py-3 text-sm"
              type="submit"
              disabled={saving || !trimmedTesterAccessCode || !trimmedOrg || (hasWebsite && !websiteConsent)}
            >
              {saving ? "Creating workspace..." : "Create workplace"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">Your information is secure and private.</p>
      </div>
    </main>
  );
}
