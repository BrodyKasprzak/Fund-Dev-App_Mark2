"use client";

import { useRouter } from "next/navigation";

type WorkspaceTopNavProps = {
  active: "documents" | "chat";
};

export function WorkspaceTopNav({ active }: WorkspaceTopNavProps) {
  const router = useRouter();

  return (
    <div className="fixed left-1/2 top-3 z-40 -translate-x-1/2">
      <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => router.push("/documents")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            active === "documents"
              ? "bg-sky-600/90 text-white"
              : "bg-sky-50/90 text-sky-700/90 hover:bg-sky-100/90"
          }`}
        >
          Documents
        </button>
        <button
          type="button"
          onClick={() => router.push("/chat")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            active === "chat"
              ? "bg-emerald-600/90 text-white"
              : "bg-emerald-50/90 text-emerald-700/90 hover:bg-emerald-100/90"
          }`}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={() => router.push("/products")}
          className="rounded-full bg-amber-50/90 px-3 py-1.5 text-xs font-semibold text-amber-700/90 transition hover:bg-amber-100/90"
        >
          Create
        </button>
      </div>
    </div>
  );
}
