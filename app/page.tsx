"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "purpose" | "products" | "contact";

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border border-slate-300 bg-white text-slate-900 shadow-sm"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("purpose");

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#f8fafc_0%,_#f8fafc_55%,_#f1f5f9_100%)] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white">
              <span className="text-sm font-bold text-slate-900">PF</span>
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">PurposeFramework</p>
              <p className="text-xs text-slate-500">Document systems for nonprofits</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 md:flex">
            <TabButton
              active={activeTab === "purpose"}
              label="PurposeFramework"
              onClick={() => setActiveTab("purpose")}
            />
            <TabButton
              active={activeTab === "products"}
              label="Products"
              onClick={() => setActiveTab("products")}
            />
            <TabButton
              active={activeTab === "contact"}
              label="Contact"
              onClick={() => setActiveTab("contact")}
            />
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/login")}
              className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Sign in
            </button>
            <button
              onClick={() => router.push("/register")}
              className="rounded-full border border-primary-300 bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600"
            >
              New Organization
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        {activeTab === "purpose" ? (
          <div className="space-y-8">
            <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
                <p className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />
                  Modern nonprofit DMS + planning workspace
                </p>
                <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
                  Purpose-built document operations for fundraising teams.
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-lg">
                  PurposeFramework gives nonprofit leaders one place to store, structure, and produce
                  high-value development documentation. It combines disciplined document management with
                  guided strategy workflows so teams can move faster without losing governance quality.
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => router.push("/register")}
                    className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    Launch your workspace
                  </button>
                  <button
                    onClick={() => setActiveTab("products")}
                    className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                  >
                    Explore products
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <h2 className="text-xl font-bold text-slate-900">Who this is for</h2>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    Development directors who need institutional consistency across plans and files.
                  </p>
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    Executive teams managing audit readiness, grant artifacts, and board-facing materials.
                  </p>
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    Consultants and operations staff building repeatable systems for multiple campaigns.
                  </p>
                </div>
                <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Why PurposeFramework
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Most teams have documents everywhere and strategy nowhere. PurposeFramework connects both,
                  so planning, execution, and accountability happen in one professional system.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-3 h-1.5 w-16 rounded-full bg-primary-400" />
                <h3 className="text-lg font-semibold text-slate-900">Standardized Documents</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Centralize critical files with structure, ownership, and clean retrieval across teams.
                </p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-3 h-1.5 w-16 rounded-full bg-accent-400" />
                <h3 className="text-lg font-semibold text-slate-900">Strategic Builders</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Build handbooks and plans through guided workflows tailored to your organizational context.
                </p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-3 h-1.5 w-16 rounded-full bg-success-400" />
                <h3 className="text-lg font-semibold text-slate-900">Operational Confidence</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Improve consistency, reduce rework, and keep your team aligned on what is approved and current.
                </p>
              </article>
            </div>
          </div>
        ) : null}

        {activeTab === "products" ? (
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Products</h1>
              <p className="mt-3 max-w-3xl text-base text-slate-600 sm:text-lg">
                Professional tools designed for nonprofit development operations, with the reliability and
                structure expected from modern document management platforms.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <article className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                  Product 01
                </p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">Document Management System</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  Organize institutional records, governance artifacts, and fundraising materials in a secure,
                  searchable, and team-accessible environment.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-slate-600">
                  <li>Role-aware organization-level access</li>
                  <li>Version visibility and easier document retrieval</li>
                  <li>Single source of truth for critical operational files</li>
                </ul>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">
                  Product 02
                </p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">AI-Assisted Development Builders</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  Draft high-quality development assets with structure-first workflows that keep your team focused
                  on strategic content, not formatting overhead.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-slate-600">
                  <li>Fund Development Handbook workflows</li>
                  <li>Annual Fund Development Plan generation</li>
                  <li>Case for Support and campaign planning templates</li>
                </ul>
              </article>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <p className="max-w-2xl text-sm text-slate-600">
                  Start with secure document operations, then layer in your strategic planning workflows as your
                  team scales.
                </p>
                <button
                  onClick={() => router.push("/register")}
                  className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  Create your organization
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "contact" ? (
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Contact</h1>
              <p className="mt-3 max-w-3xl text-base text-slate-600 sm:text-lg">
                If you are evaluating PurposeFramework for your nonprofit or consulting team, we can help map
                your current document and planning process into a cleaner operational model.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <article className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900">Best fit organizations</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  Teams with growing fundraising complexity, shared ownership across staff/board, and a need for
                  consistent documentation standards.
                </p>
              </article>
              <article className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900">Current status</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  Contact intake is being finalized. For now, create an organization to view the full product flow.
                </p>
              </article>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <button
                onClick={() => router.push("/register")}
                className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Start now
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>(c) 2026 PurposeFramework</p>
          <p>Secure document operations for nonprofit fundraising teams</p>
        </div>
      </footer>
    </main>
  );
}

