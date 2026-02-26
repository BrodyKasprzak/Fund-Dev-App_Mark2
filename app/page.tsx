"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KnowledgeAssetPanel } from "@/components/workspace/KnowledgeAssetPanel";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  ShieldCheck,
  ChevronRight,
  Database,
  LayoutTemplate,
  CheckCircle2,
  Building2,
  Briefcase,
  Network,
  ArrowRight
} from "lucide-react";

type Tab = "purpose" | "products" | "contact";

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("purpose");

  const tabs: { id: Tab; label: string }[] = [
    { id: "purpose", label: "PurposeFramework" },
    { id: "products", label: "Products" },
    { id: "contact", label: "Contact" },
  ];

  return (
    <main className="relative min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* PROFESSIONAL HEADER */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6">
          
          {/* Logo Area */}
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-900">
              <span className="text-xs font-bold text-white tracking-wider">PF</span>
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-slate-900">PurposeFramework</p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="active-nav-tab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                {tab.label}
              </button>
            ))}
          </nav>

          {/* CTA Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/login")}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              Sign in
            </button>
            <button
              onClick={() => router.push("/register")}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-slate-800 shadow-sm"
            >
              New Organization
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <div className="mx-auto max-w-6xl px-5 pt-12 pb-24 sm:px-6">
        <AnimatePresence mode="wait">
          
          {/* ----- PURPOSE TAB ----- */}
          {activeTab === "purpose" && (
            <motion.div
              key="purpose"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-20"
            >
              
              {/* Hero Section */}
              <section className="text-center max-w-4xl mx-auto pt-8">
                <motion.div
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700 mb-6"
                >
                  Manager + Knowledge Base + Creator
                </motion.div>
                
                <motion.h1 
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                  className="text-3xl md:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.15]"
                >
                  Purpose-built document operations for growth and sustainability.
                </motion.h1>

                <motion.p 
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                  className="mt-6 text-lg text-slate-600 leading-relaxed max-w-3xl mx-auto"
                >
                  PurposeFramework gives nonprofit leaders one place to store, structure, and produce high-value development documentation. It combines disciplined document management with guided strategy workflows so teams can move faster without losing governance quality.
                </motion.p>

                <motion.div 
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                  className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
                >
                  <button
                    onClick={() => router.push("/register")}
                    className="w-full sm:w-auto rounded-md bg-slate-900 px-6 py-3 text-sm font-medium text-white transition-all hover:bg-slate-800 shadow-sm flex items-center justify-center gap-2 group"
                  >
                    Launch your workspace
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <button
                    onClick={() => setActiveTab("products")}
                    className="w-full sm:w-auto rounded-md border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50"
                  >
                    Explore products
                  </button>
                </motion.div>
              </section>

              {/* Stacked Layout: Built For -> Strategic Insights */}
              <div className="space-y-8">
                
                {/* 1. Built For Section */}
                <section className="rounded-2xl border border-slate-200 bg-white p-8 md:p-12 shadow-sm">
                  <div className="border-b border-slate-100 pb-6 mb-8">
                    <h2 className="text-2xl font-bold text-slate-900">Built for the complexity of real operations</h2>
                    <p className="mt-2 text-slate-600">Standardize your operations across your entire development team.</p>
                  </div>
                  
                  <div className="grid md:grid-cols-3 gap-8">
                    <div className="flex flex-col gap-3">
                      <div className="h-10 w-10 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <h3 className="font-semibold text-slate-900">Development Directors</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        For leaders who need institutional consistency across plans, files, and moving parts.
                      </p>
                    </div>
                    
                    <div className="flex flex-col gap-3">
                      <div className="h-10 w-10 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                        <Briefcase className="h-5 w-5" />
                      </div>
                      <h3 className="font-semibold text-slate-900">Executive Teams</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        For executives managing audit readiness, grant artifacts, and board-facing materials.
                      </p>
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="h-10 w-10 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                        <Network className="h-5 w-5" />
                      </div>
                      <h3 className="font-semibold text-slate-900">Consultants & Ops</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        For staff building highly repeatable document systems for multiple campaigns.
                      </p>
                    </div>
                  </div>
                </section>

                {/* 2. Strategic Insights (3 Pillars) */}
                <section className="grid md:grid-cols-3 gap-6">
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md transition-shadow">
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <FileText className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2">Standardized Documents</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Centralize critical files with strict structure, clear ownership, and clean retrieval across teams.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md transition-shadow">
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <Database className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2">Strategic Builders</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Build robust handbooks and plans through guided workflows tailored to your organizational context.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md transition-shadow">
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2">Operational Confidence</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Improve structural consistency, reduce rework, and keep your team aligned on what is current.
                    </p>
                  </div>
                </section>
                
              </div>

              {/* Knowledge Panel */}
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                 <KnowledgeAssetPanel />
              </section>

            </motion.div>
          )}

          {/* ----- PRODUCTS TAB ----- */}
          {activeTab === "products" && (
            <motion.div
              key="products"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-12 pt-8"
            >
              <div className="max-w-3xl mb-12">
                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 mb-4">Products</h1>
                <p className="text-lg text-slate-600">
                  Professional tools designed for nonprofit development operations, with the reliability and structure expected from modern document management platforms.
                </p>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                {/* Product 01 */}
                <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                  <div className="mb-6">
                    <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">Product 01</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-3">Document Management System</h2>
                  <p className="text-slate-600 leading-relaxed mb-8 flex-grow">
                    Organize institutional records, governance artifacts, and fundraising materials in a secure, searchable, and team-accessible environment.
                  </p>
                  <ul className="space-y-3 pt-6 border-t border-slate-100">
                    {["Role-aware organization-level access", "Version visibility and easier document retrieval", "Single source of truth for critical operational files"].map((feat, i) => (
                      <li key={i} className="flex items-start gap-3 text-slate-700 text-sm">
                        <CheckCircle2 className="h-5 w-5 text-blue-600 shrink-0" />
                        {feat}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Product 02 */}
                <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                  <div className="mb-6">
                    <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">Product 02</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-3">AI-Assisted Development Builders</h2>
                  <p className="text-slate-600 leading-relaxed mb-8 flex-grow">
                    Draft high-quality development assets with structure-first workflows that keep your team focused on strategic content, not formatting overhead.
                  </p>
                  <ul className="space-y-3 pt-6 border-t border-slate-100">
                    {["Fund Development Handbook workflows", "Annual Fund Development Plan generation", "Case for Support and campaign planning templates"].map((feat, i) => (
                      <li key={i} className="flex items-start gap-3 text-slate-700 text-sm">
                        <CheckCircle2 className="h-5 w-5 text-blue-600 shrink-0" />
                        {feat}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-900 p-8 sm:p-10 shadow-lg mt-8">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                  <div className="max-w-2xl">
                    <h3 className="text-xl font-bold text-white mb-2">Ready to standardize your workflow?</h3>
                    <p className="text-slate-300 text-sm">
                      Start with secure document operations, then layer in your strategic planning workflows as your team scales.
                    </p>
                  </div>
                  <button
                    onClick={() => router.push("/register")}
                    className="shrink-0 rounded-md bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
                  >
                    Create your organization
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ----- CONTACT TAB ----- */}
          {activeTab === "contact" && (
            <motion.div
              key="contact"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-10 pt-8"
            >
              <div className="max-w-3xl mb-12">
                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 mb-4">Contact</h1>
                <p className="text-lg text-slate-600">
                  If you are evaluating PurposeFramework for your nonprofit or consulting team, we can help map your current document and planning process into a cleaner operational model.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 mb-2">Best fit organizations</h2>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Teams with growing fundraising complexity, shared ownership across staff/board, and a need for consistent documentation standards.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                      <LayoutTemplate className="h-5 w-5" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Current status</h2>
                    <p className="text-slate-600 text-sm leading-relaxed mb-6">
                      Contact intake is being finalized. For now, create an organization to view the full product flow.
                    </p>
                  </div>
                  <button
                    onClick={() => router.push("/register")}
                    className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    Start now
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* FOOTER */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">PurposeFramework</span>
            <span>&copy; 2026</span>
          </div>
          <p>Secure document operations for nonprofit fundraising teams.</p>
        </div>
      </footer>
    </main>
  );
}


// "use client";

// import { useState, type CSSProperties } from "react";
// import { useRouter } from "next/navigation";
// import { KnowledgeAssetPanel } from "@/components/workspace/KnowledgeAssetPanel";

// type Tab = "purpose" | "products" | "contact";

// type FloatingFileConfig = {
//   id: string;
//   top: string;
//   left: string;
//   width: number;
//   rotate: number;
//   duration: number;
//   delay: number;
//   opacity: number;
// };

// const FLOATING_FILES: FloatingFileConfig[] = [
//   { id: "file-1", top: "12%", left: "7%", width: 234, rotate: -8, duration: 16, delay: 0, opacity: 0.88 },
//   { id: "file-2", top: "62%", left: "8%", width: 230, rotate: -6, duration: 19, delay: 3, opacity: 0.86 },
// ];

// function FloatingFilesBackground() {
//   return (
//     <div className="pointer-events-none absolute inset-0" aria-hidden="true">
//       <div className="absolute left-[4%] top-[8%] h-72 w-72 rounded-full bg-primary-200/35 blur-[80px]" />

//       {FLOATING_FILES.map((file) => (
//         <div
//           key={file.id}
//           className="pf-file absolute rounded-2xl border border-primary-200/55 bg-white/72 shadow-[0_20px_44px_rgba(15,23,42,0.08)] backdrop-blur-sm"
//           style={
//             {
//               top: file.top,
//               left: file.left,
//               width: `${file.width}px`,
//               height: `${Math.round(file.width * 1.3)}px`,
//               "--pf-rotate": `${file.rotate}deg`,
//               opacity: file.opacity,
//               animationDuration: `${file.duration}s`,
//               animationDelay: `-${file.delay}s`,
//             } as CSSProperties & Record<"--pf-rotate", string>
//           }
//         >
//           <div className="bg-[linear-gradient(90deg,rgba(85,81,168,0.10)_0%,rgba(194,118,163,0.08)_55%,rgba(95,138,114,0.08)_100%)] border-b border-primary-200/45 px-4 py-3">
//             <div className="h-2.5 w-16 rounded-full bg-primary-300/70" />
//           </div>
//           <div className="space-y-2 px-4 py-3">
//             <div className="h-2 w-full rounded-full bg-primary-100/85" />
//             <div className="h-2 w-10/12 rounded-full bg-slate-200/90" />
//             <div className="h-2 w-8/12 rounded-full bg-accent-100/80" />
//             <div className="h-2 w-9/12 rounded-full bg-slate-200/90" />
//             <div className="h-2 w-7/12 rounded-full bg-success-100/80" />
//           </div>
//         </div>
//       ))}
//     </div>
//   );
// }

// function TabButton({
//   active,
//   label,
//   onClick,
// }: {
//   active: boolean;
//   label: string;
//   onClick: () => void;
// }) {
//   return (
//     <button
//       onClick={onClick}
//       className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
//         active
//           ? "border border-slate-300 bg-white text-slate-900 shadow-sm"
//           : "text-slate-600 hover:bg-white hover:text-slate-900"
//       }`}
//     >
//       {label}
//     </button>
//   );
// }

// export default function Home() {
//   const router = useRouter();
//   const [activeTab, setActiveTab] = useState<Tab>("purpose");

//   return (
//     <main className="relative min-h-screen overflow-x-hidden bg-[linear-gradient(165deg,#f8fafc_0%,#f3f6fb_45%,#eef3f9_100%)] text-slate-900">
//       <FloatingFilesBackground />

//       <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur">
//         <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
//           <div className="flex items-center gap-3">
//             <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white">
//               <span className="text-sm font-bold text-slate-900">PF</span>
//             </div>
//             <div>
//               <p className="text-sm font-bold tracking-tight">PurposeFramework</p>
//               <p className="text-xs text-slate-500">Document systems for nonprofits</p>
//             </div>
//           </div>

//           <nav className="hidden items-center gap-1 rounded-full border border-slate-200 bg-white/90 p-1 md:flex">
//             <TabButton
//               active={activeTab === "purpose"}
//               label="PurposeFramework"
//               onClick={() => setActiveTab("purpose")}
//             />
//             <TabButton
//               active={activeTab === "products"}
//               label="Products"
//               onClick={() => setActiveTab("products")}
//             />
//             <TabButton
//               active={activeTab === "contact"}
//               label="Contact"
//               onClick={() => setActiveTab("contact")}
//             />
//           </nav>

//           <div className="flex items-center gap-2">
//             <button
//               onClick={() => router.push("/login")}
//               className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
//             >
//               Sign in
//             </button>
//             <button
//               onClick={() => router.push("/register")}
//               className="rounded-full border border-primary-300 bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600"
//             >
//               New Organization
//             </button>
//           </div>
//         </div>
//       </header>

//       <section className="relative z-10 mx-auto max-w-7xl px-5 py-10 sm:px-8">
//         {activeTab === "purpose" ? (
//           <div className="space-y-8">
//             <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
//               <div className="rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm sm:p-10">
//                 <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-700">
//                   PurposeFramework
//                 </p>
//                 <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
//                   Purpose-built document operations for fundraisers.
//                 </h1>
//                 <p className="mt-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
//                   Manager + Knowledge Base + Creator
//                 </p>
//                 <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-lg">
//                   PurposeFramework gives nonprofit leaders one place to store, structure, and produce
//                   high-value development documentation. It combines disciplined document management with
//                   guided strategy workflows so teams can move faster without losing governance quality.
//                 </p>
//                 <div className="mt-5 flex flex-wrap gap-2">
//                   <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
//                     Document manager
//                   </span>
//                   <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
//                     Grounded knowledge base
//                   </span>
//                   <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
//                     Strategic creator
//                   </span>
//                 </div>
//                 <div className="mt-7 flex flex-wrap items-center gap-3">
//                   <button
//                     onClick={() => router.push("/register")}
//                     className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
//                   >
//                     Launch your workspace
//                   </button>
//                   <button
//                     onClick={() => setActiveTab("products")}
//                     className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
//                   >
//                     Explore products
//                   </button>
//                 </div>
//               </div>

//               <div className="rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm sm:p-8">
//                 <h2 className="text-xl font-bold text-slate-900">Who this is for</h2>
//                 <div className="mt-4 space-y-3 text-sm text-slate-600">
//                   <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
//                     Development directors who need institutional consistency across plans and files.
//                   </p>
//                   <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
//                     Executive teams managing audit readiness, grant artifacts, and board-facing materials.
//                   </p>
//                   <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
//                     Consultants and operations staff building repeatable systems for multiple campaigns.
//                   </p>
//                 </div>
//                 <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
//                   Why PurposeFramework
//                 </h3>
//                 <p className="mt-2 text-sm leading-relaxed text-slate-600">
//                   Most teams have documents everywhere and strategy nowhere. PurposeFramework connects both,
//                   so planning, execution, and accountability happen in one professional system.
//                 </p>
//               </div>
//             </div>

//             <div className="grid gap-4 md:grid-cols-3">
//               <article className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm">
//                 <div className="mb-3 h-1.5 w-16 rounded-full bg-primary-400" />
//                 <h3 className="text-lg font-semibold text-slate-900">Standardized Documents</h3>
//                 <p className="mt-2 text-sm leading-relaxed text-slate-600">
//                   Centralize critical files with structure, ownership, and clean retrieval across teams.
//                 </p>
//               </article>
//               <article className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm">
//                 <div className="mb-3 h-1.5 w-16 rounded-full bg-accent-400" />
//                 <h3 className="text-lg font-semibold text-slate-900">Strategic Builders</h3>
//                 <p className="mt-2 text-sm leading-relaxed text-slate-600">
//                   Build handbooks and plans through guided workflows tailored to your organizational context.
//                 </p>
//               </article>
//               <article className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm">
//                 <div className="mb-3 h-1.5 w-16 rounded-full bg-success-400" />
//                 <h3 className="text-lg font-semibold text-slate-900">Operational Confidence</h3>
//                 <p className="mt-2 text-sm leading-relaxed text-slate-600">
//                   Improve consistency, reduce rework, and keep your team aligned on what is approved and current.
//                 </p>
//               </article>
//             </div>

//             <KnowledgeAssetPanel />
//           </div>
//         ) : null}

//         {activeTab === "products" ? (
//           <div className="space-y-6">
//             <div className="rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-sm sm:p-10">
//               <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Products</h1>
//               <p className="mt-3 max-w-3xl text-base text-slate-600 sm:text-lg">
//                 Professional tools designed for nonprofit development operations, with the reliability and
//                 structure expected from modern document management platforms.
//               </p>
//             </div>

//             <div className="grid gap-5 lg:grid-cols-2">
//               <article className="rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm sm:p-8">
//                 <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
//                   Product 01
//                 </p>
//                 <h2 className="mt-2 text-2xl font-bold text-slate-900">Document Management System</h2>
//                 <p className="mt-3 text-sm leading-relaxed text-slate-600">
//                   Organize institutional records, governance artifacts, and fundraising materials in a secure,
//                   searchable, and team-accessible environment.
//                 </p>
//                 <ul className="mt-4 space-y-2 text-sm text-slate-600">
//                   <li>Role-aware organization-level access</li>
//                   <li>Version visibility and easier document retrieval</li>
//                   <li>Single source of truth for critical operational files</li>
//                 </ul>
//               </article>

//               <article className="rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm sm:p-8">
//                 <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">
//                   Product 02
//                 </p>
//                 <h2 className="mt-2 text-2xl font-bold text-slate-900">AI-Assisted Development Builders</h2>
//                 <p className="mt-3 text-sm leading-relaxed text-slate-600">
//                   Draft high-quality development assets with structure-first workflows that keep your team focused
//                   on strategic content, not formatting overhead.
//                 </p>
//                 <ul className="mt-4 space-y-2 text-sm text-slate-600">
//                   <li>Fund Development Handbook workflows</li>
//                   <li>Annual Fund Development Plan generation</li>
//                   <li>Case for Support and campaign planning templates</li>
//                 </ul>
//               </article>
//             </div>

//             <div className="rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm sm:p-8">
//               <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
//                 <p className="max-w-2xl text-sm text-slate-600">
//                   Start with secure document operations, then layer in your strategic planning workflows as your
//                   team scales.
//                 </p>
//                 <button
//                   onClick={() => router.push("/register")}
//                   className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
//                 >
//                   Create your organization
//                 </button>
//               </div>
//             </div>
//           </div>
//         ) : null}

//         {activeTab === "contact" ? (
//           <div className="space-y-6">
//             <div className="rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-sm sm:p-10">
//               <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Contact</h1>
//               <p className="mt-3 max-w-3xl text-base text-slate-600 sm:text-lg">
//                 If you are evaluating PurposeFramework for your nonprofit or consulting team, we can help map
//                 your current document and planning process into a cleaner operational model.
//               </p>
//             </div>

//             <div className="grid gap-5 md:grid-cols-2">
//               <article className="rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm">
//                 <h2 className="text-xl font-bold text-slate-900">Best fit organizations</h2>
//                 <p className="mt-3 text-sm leading-relaxed text-slate-600">
//                   Teams with growing fundraising complexity, shared ownership across staff/board, and a need for
//                   consistent documentation standards.
//                 </p>
//               </article>
//               <article className="rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm">
//                 <h2 className="text-xl font-bold text-slate-900">Current status</h2>
//                 <p className="mt-3 text-sm leading-relaxed text-slate-600">
//                   Contact intake is being finalized. For now, create an organization to view the full product flow.
//                 </p>
//               </article>
//             </div>

//             <div className="rounded-3xl border border-slate-200 bg-white/95 p-7 shadow-sm">
//               <button
//                 onClick={() => router.push("/register")}
//                 className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
//               >
//                 Start now
//               </button>
//             </div>
//           </div>
//         ) : null}
//       </section>

//       <footer className="relative z-10 border-t border-slate-200 bg-white/95 backdrop-blur">
//         <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
//           <p>(c) 2026 PurposeFramework</p>
//           <p>Secure document operations for nonprofit fundraising teams</p>
//         </div>
//       </footer>

//       <style jsx>{`
//         .pf-file {
//           animation-name: pf-file-float;
//           animation-timing-function: ease-in-out;
//           animation-iteration-count: infinite;
//           will-change: transform;
//         }

//         @keyframes pf-file-float {
//           0%,
//           100% {
//             transform: translate3d(0, 0, 0) rotate(var(--pf-rotate, 0deg));
//           }
//           50% {
//             transform: translate3d(0, -14px, 0) rotate(var(--pf-rotate, 0deg));
//           }
//         }

//         @media (prefers-reduced-motion: reduce) {
//           .pf-file {
//             animation: none;
//           }
//         }
//       `}</style>
//     </main>
//   );
// }
