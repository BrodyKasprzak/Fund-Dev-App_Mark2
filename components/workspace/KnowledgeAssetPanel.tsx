type KnowledgeAssetPanelProps = {
  className?: string;
};

const CORE_POINTS = [
  "Your past grant language informs your next proposal.",
  "Your impact reports strengthen your future funding narratives.",
  "Your policies and procedures support onboarding and daily operations.",
  "Your institutional knowledge becomes searchable, reusable, and continuously improving.",
];

const QUICK_TIPS = [
  {
    title: "Upload your most important documents first",
    detail: "Start with recent grants, impact reports, and core program descriptions.",
  },
  {
    title: "Ask questions about your organization",
    detail: "Try: \"What programs do we run for youth?\" or \"Summarize our impact from last year.\"",
  },
  {
    title: "Reuse your strongest language",
    detail: "Pull from past grant responses and impact statements to keep messaging consistent.",
  },
  {
    title: "Centralize policies and procedures",
    detail: "Add HR policies, finance processes, and board governance materials to support your team.",
  },
  {
    title: "Build over time",
    detail: "The more documents you add, the stronger your organization's knowledge base becomes.",
  },
];

export function KnowledgeAssetPanel({ className = "" }: KnowledgeAssetPanelProps) {
  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-sm sm:p-8 ${className}`}
    >
      <div className="knowledge-bg knowledge-bg--primary" aria-hidden="true" />
      <div className="knowledge-bg knowledge-bg--secondary" aria-hidden="true" />
      <div className="knowledge-bg knowledge-bg--tertiary" aria-hidden="true" />

      <div className="relative z-10 space-y-6">
        <div className="space-y-3">
          <p className="inline-flex items-center rounded-full border border-slate-300 bg-white/85 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Strategic Insight
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Why Your Organization&apos;s Documents Are Your Most Valuable Asset
          </h2>
          <p className="text-sm leading-relaxed text-slate-700 sm:text-base">
            Every nonprofit generates a powerful body of knowledge over time: past grant applications,
            impact reports, donor communications, policies, and internal procedures. These materials are
            more than history. They are institutional intelligence.
          </p>
          <p className="text-sm leading-relaxed text-slate-700 sm:text-base">
            When that intelligence is scattered across folders, drives, and inboxes, teams lose time,
            duplicate work, and struggle to maintain consistent language. A structured document management
            approach changes that.
          </p>
          <p className="text-sm leading-relaxed text-slate-700 sm:text-base">
            By organizing fund development materials, program descriptions, policies, and operating
            procedures into one system, your organization creates a single source of truth. Communication
            improves internally and externally with funders, partners, and stakeholders.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            In PurposeFramework, those documents become active intelligence:
          </p>
          <ul className="mt-3 space-y-2">
            {CORE_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
                <span className="mt-1 inline-block h-1.5 w-1.5 flex-none rounded-full bg-primary-500" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-slate-700">
            Over time, your organization builds a living knowledge base that helps teams move faster,
            communicate more clearly, and operate with greater confidence and consistency.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            PurposeFramework is designed to help you turn existing materials into a long-term strategic
            asset, not a static archive.
          </p>
        </div>

        <div className="rounded-2xl border border-primary-200/80 bg-primary-50/80 p-5">
          <h3 className="text-base font-semibold text-primary-900">
            Quick Tips for Getting the Most from PurposeFramework
          </h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-primary-700">
            Getting Started
          </p>
          <ul className="mt-3 space-y-3">
            {QUICK_TIPS.map((tip) => (
              <li key={tip.title}>
                <p className="text-sm font-semibold text-slate-900">{tip.title}</p>
                <p className="text-sm leading-relaxed text-slate-700">{tip.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
