"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "purpose" | "products" | "contact";

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("purpose");

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50">
      {/* Header with Tabs */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50 shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Logo/Brand */}
            <div className="flex items-center gap-3">
              <div className="flex px-4 py-2 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-400 shadow-lg">
                <span className="text-base font-bold text-white whitespace-nowrap">PF</span>
              </div>
              <span className="text-lg font-bold text-slate-900 hidden sm:inline">PurposeFramework</span>
            </div>

            {/* Center: Tab Navigation */}
            <nav className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("purpose")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === "purpose"
                    ? "bg-gradient-to-r from-primary-500 to-accent-400 text-white shadow-lg shadow-primary-500/30"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                PurposeFramework
              </button>
              <button
                onClick={() => setActiveTab("products")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === "products"
                    ? "bg-gradient-to-r from-primary-500 to-accent-400 text-white shadow-lg shadow-primary-500/30"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                Products
              </button>
              <button
                onClick={() => setActiveTab("contact")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === "contact"
                    ? "bg-gradient-to-r from-primary-500 to-accent-400 text-white shadow-lg shadow-primary-500/30"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                Contact Us
              </button>
            </nav>

            {/* Right: Auth Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/login")}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                Sign in
              </button>
              <button
                onClick={() => router.push("/register")}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-primary-500 to-accent-400 text-white hover:from-primary-600 hover:to-primary-500 shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 transition"
              >
                New Organization
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content Area with Sliding Transitions */}
      <div className="relative overflow-hidden">
        <div
          className="flex transition-transform duration-500 ease-in-out"
          style={{
            transform: `translateX(-${
              activeTab === "purpose" ? 0 : activeTab === "products" ? 100 : 200
            }%)`,
          }}
        >
          {/* PurposeFramework Tab */}
          <div className="min-w-full flex-shrink-0 px-6 py-16">
            <div className="mx-auto max-w-4xl">
              <div className="text-center mb-12">
                <div className="inline-flex px-8 py-5 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 mb-6 shadow-2xl">
                  <span className="text-3xl font-bold text-white whitespace-nowrap">PurposeFramework</span>
                </div>
                <h1 className="text-5xl font-bold text-slate-900 mb-4">
                  Welcome to PurposeFramework
                </h1>
                <p className="text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto">
                  Secure document management and builder platform for Non-Profits
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-3 mt-12">
                <div className="rounded-2xl border-2 border-primary-200 bg-white p-6 shadow-lg">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-purple-400 to-primary-500 mb-4"></div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Secure Storage</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Secure storage for all your nonprofit's important documents, update them all in the same place, at the same time 
                  </p>
                </div>

                <div className="rounded-2xl border-2 border-primary-200 bg-white p-6 shadow-lg">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-accent-300 to-primary-500 mb-4"></div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">AI-Powered Builder</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Create professional fundraising documents with your organization's context, intelligent guidance, and templates
                  </p>
                </div>

                <div className="rounded-2xl border-2 border-primary-200 bg-white p-6 shadow-lg">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-success-300 to-success-400 mb-4"></div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Team Collaboration</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Work together seamlessly with your team on long term strategic planning and documentation
                  </p>
                </div>
              </div>

              <div className="mt-12 text-center">
                <button
                  onClick={() => router.push("/register")}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-lg font-bold bg-gradient-to-r from-primary-500 to-accent-400 text-white hover:from-primary-600 hover:to-primary-500 shadow-2xl shadow-primary-500/40 hover:shadow-primary-500/60 transition-all"
                >
                  Get Started Free
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Products Tab */}
          <div className="min-w-full flex-shrink-0 px-6 py-16">
            <div className="mx-auto max-w-4xl">
              <div className="text-center mb-12">
                <div className="inline-flex items-center gap-2 mb-6">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-success-300 to-success-400"></div>
                  <h1 className="text-5xl font-bold text-slate-900">Products</h1>
                </div>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Professional tools designed specifically for nonprofit organizations
                </p>
              </div>

              <div className="space-y-8">
                {/* Product 1: Document Management */}
                <div className="rounded-2xl border-2 border-primary-200 bg-white p-8 shadow-xl">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 flex items-center justify-center shadow-lg">
                        <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                        </svg>
                      </div>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold text-slate-900 mb-3">
                        Document Management System
                      </h3>
                      <p className="text-slate-600 leading-relaxed mb-4">
                        <span className="font-semibold text-slate-900">Durably Harmonizing, Organizing, and Storing</span> your organization's documents. 
                        Keep all your critical nonprofit documentation secure, accessible, and organized in one central location.
                      </p>
                      <ul className="space-y-2 text-sm text-slate-600">
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Secure cloud storage with enterprise-grade encryption
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Version control and audit trails
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Team collaboration and permissions management
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Update multiple documents at once
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Easy information and document retrieval  
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Product 2: Document Builder */}
                <div className="rounded-2xl border-2 border-primary-200 bg-white p-8 shadow-xl">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-500 flex items-center justify-center shadow-lg">
                        <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold text-slate-900 mb-3">
                        AI-Powered Document Builder
                      </h3>
                      <p className="text-slate-600 leading-relaxed mb-4">
                        <span className="font-semibold text-slate-900">Build Fund Development Documents and Organizational Legacy Documents</span> with 
                        expert guidance. Our AI-powered platform helps you create professional, consultant-grade documentation tailored to your nonprofit.
                      </p>
                      <ul className="space-y-2 text-sm text-slate-600">
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Fund Development Handbooks
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Annual Fund Development Plans
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Case for Support & Campaign Plans
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary-500"></div>
                          Grant Strategies & More
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-12 text-center">
                <button
                  onClick={() => router.push("/register")}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-lg font-bold bg-gradient-to-r from-primary-500 to-accent-400 text-white hover:from-primary-600 hover:to-primary-500 shadow-2xl shadow-primary-500/40 hover:shadow-primary-500/60 transition-all"
                >
                  Start Building Today
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Contact Us Tab */}
          <div className="min-w-full flex-shrink-0 px-6 py-16">
            <div className="mx-auto max-w-4xl">
              <div className="text-center mb-12">
                <div className="inline-flex items-center gap-2 mb-6">
                  <div className="h-3 w-3 rounded-full bg-gradient-to-r from-success-300 to-success-400"></div>
                  <h1 className="text-5xl font-bold text-slate-900">Contact Us</h1>
                </div>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Get in touch with our team
                </p>
              </div>

              <div className="rounded-2xl border-2 border-slate-200 bg-white p-12 shadow-xl text-center">
                <div className="inline-flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-100 to-primary-100 mb-6">
                  <svg className="h-12 w-12 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-slate-900 mb-3">
                  Contact information coming soon
                </h3>
                <p className="text-slate-600 mb-8">
                  We're setting up the best way to connect with you. In the meantime, create your organization to get started.
                </p>
                <button
                  onClick={() => router.push("/register")}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-lg font-bold bg-gradient-to-r from-primary-500 to-accent-400 text-white hover:from-primary-600 hover:to-primary-500 shadow-2xl shadow-primary-500/40 hover:shadow-primary-500/60 transition-all"
                >
                  Create Your Organization
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white/80 backdrop-blur-sm mt-16">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex px-3 py-1.5 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-accent-400">
                <span className="text-sm font-bold text-white">PF</span>
              </div>
              <span className="text-sm text-slate-600">© 2026 PurposeFramework</span>
            </div>
            <div className="text-sm text-slate-500">
              Empowering nonprofits with professional tools
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}




// export default function Home() {
//   return (
//     <main className="min-h-screen flex items-center justify-center p-6">
//       <div className="w-full max-w-xl text-center space-y-4">
//         <h1 className="text-3xl font-semibold">Fund Development Builder</h1>
//         <p className="opacity-80">
//           Build a professional fund development plan with structured intake.
//         </p>

//         <div className="flex items-center justify-center gap-3">
//           <a className="border rounded-md px-4 py-2" href="/login">
//             Log in
//           </a>
//           <a className="border rounded-md px-4 py-2" href="/register">
//             Create account
//           </a>
//         </div>

//         <div className="pt-2">
//           <a className="underline text-sm opacity-80" href="/app/dashboard">
//             Go to dashboard
//           </a>
//         </div>
//       </div>
//     </main>
//   );
// }


