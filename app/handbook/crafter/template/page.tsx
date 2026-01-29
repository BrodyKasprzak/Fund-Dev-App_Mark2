"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/AuthContext";
import { doc, getDoc } from "firebase/firestore";
import { BASE_TEMPLATES } from "@/lib/handbookTemplates";

type Section = {
  key: string;
  title: string;
  order: number;
};

type Plan = {
  id: string;
  title?: string;
  templateType?: string;
  data?: any;
  status?: string;
};

type Question = {
  id: string;
  label: string;
  helper?: string;
  placeholder?: string;
  type?: "text" | "textarea" | "select" | "multiselect";
  options?: string[];
  required?: boolean;
};

type HandbookSectionState = {
  base: string;
  content: string;
  answers: Record<string, string>;
  completed: boolean;
  revealed: boolean;
  dirty: boolean;
  started: boolean;
  typed: boolean;
  aiQuestions?: Question[];
  templateHash?: string;
  questionsGeneratedAt?: string;
  generatedAt?: string;
};

type OrgProfile = {
  id: string;
  name: string;
  mission?: string | null;
  homeState?: string | null;
  taxStatus?: string | null;
  fiscalYear?: string | null;
  crm?: string | null;
  address?: string | null;
  numEmployees?: number | null;
  foundedYear?: number | null;
  websiteUrl?: string | null;
  websiteConsent?: boolean | null;
};

const PROFILE_SECTION: Section = {
  key: "s0_profile",
  title: "0. Base informational questions",
  order: 0,
};

const SECTIONS: Section[] = [
  { key: "s1_intro", title: "1. Introduction and Purpose", order: 1 },
  { key: "s2_philosophy", title: "2. Fund Development Philosophy and Definitions", order: 2 },
  { key: "s3_roles", title: "3. Roles and Responsibilities", order: 3 },
  { key: "s4_ethics", title: "4. Ethical Fundraising Framework", order: 4 },
  { key: "s5_gift_acceptance", title: "5. Gift Acceptance Policy", order: 5 },
  { key: "s5a_major_gifts", title: "5A. Major Gifts Acceptance Policy", order: 6 },
  { key: "s6_processing", title: "6. Gift Processing Policies and Procedures", order: 7 },
  { key: "s7_recognition", title: "7. Donor Recognition and Acknowledgement", order: 8 },
  { key: "s8_stewardship", title: "8. Donor Cultivation and Stewardship", order: 9 },
  { key: "s9_grants", title: "9. Grants Management", order: 10 },
  { key: "s10_awards_declines", title: "10. Funding Announcements and Declinations", order: 11 },
  { key: "s11_sponsorships", title: "11. Corporate Sponsorships", order: 12 },
  { key: "s12_events", title: "12. Special Events Fundraising", order: 13 },
  { key: "s13_inkind", title: "13. In-Kind Donations", order: 14 },
  { key: "s14_planned_giving", title: "14. Legacy and Planned Giving", order: 15 },
  { key: "s15_financial", title: "15. Financial Management and Reporting", order: 16 },
  { key: "s16_compliance", title: "16. Compliance, Governance, and Accountability", order: 17 },
  { key: "s17_appendices", title: "17. Appendices and Attachments", order: 18 },
];

const ALL_NAV: Section[] = [PROFILE_SECTION, ...SECTIONS];

function classNames(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ");
}

function wordTokens(full: string) {
  return full.match(/\S+\s*/g) ?? [];
}

function parseMulti(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function questionsCompleteWith(qs: Question[], answers?: Record<string, string>) {
  if (!qs || qs.length === 0) return true;
  const ans = answers ?? {};

  return qs.every((q) => {
    const required = q.required !== false;
    if (!required) return true;

    const raw = String(ans[q.id] ?? "").trim();
    if (!raw) return false;

    const otherKey = `${q.id}__other`;
    const otherText = String(ans[otherKey] ?? "").trim();
    const hasOtherOption = Array.isArray(q.options) && q.options.includes("Other");

    if (q.type === "multiselect") {
      const vals = parseMulti(raw);
      if (vals.length === 0) return false;
      if (hasOtherOption && vals.includes("Other")) return otherText.length > 0;
      return true;
    }

    if (hasOtherOption && raw === "Other") return otherText.length > 0;

    return true;
  });
}

function initialsFromName(name?: string) {
  const n = String(name ?? "").trim();
  if (!n) return "O";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "O";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase();
}

type TypingState = {
  tokens: string[];
  idx: number;
  display: string;
  done: boolean;
};

export default function FundDevHandbookTemplatePage() {
  const router = useRouter();
  const params = useSearchParams();
  const planId = params.get("planId");
  const { user, loading } = useAuth();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [activeKey, setActiveKey] = useState<string>(PROFILE_SECTION.key);

  const [orgName, setOrgName] = useState<string>("");

  const [profileCompleted, setProfileCompleted] = useState<boolean>(false);

  const [sectionsState, setSectionsState] = useState<Record<string, HandbookSectionState>>({});

  const [typingMap, setTypingMap] = useState<Record<string, TypingState>>({});
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Profile popover state
  const [profileOpen, setProfileOpen] = useState(false);
  const profileBtnRef = useRef<HTMLButtonElement | null>(null);
  const profilePopoverRef = useRef<HTMLDivElement | null>(null);

  const [exporting, setExporting] = useState<null | "pdf" | "docx">(null);
  const [approving, setApproving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);

  // Org profile state
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [orgInfoOpen, setOrgInfoOpen] = useState(false);
  const [checkingOrg, setCheckingOrg] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  // Load org profile
  useEffect(() => {
    async function loadOrg() {
      if (loading) return;
      if (!user) {
        setCheckingOrg(false);
        return;
      }

      setCheckingOrg(true);
      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        const data = snap.exists() ? snap.data() : null;
        const orgId = (data as any)?.orgId;

        if (!orgId) {
          setOrg(null);
          return;
        }

        const memberRef = doc(db, "organizations", orgId, "members", user.uid);
        const memberSnap = await getDoc(memberRef);
        if (!memberSnap.exists()) {
          setOrg(null);
          return;
        }

        const orgRef = doc(db, "organizations", orgId);
        const orgSnap = await getDoc(orgRef);
        if (!orgSnap.exists()) {
          setOrg(null);
          return;
        }

        const o = orgSnap.data() as any;

        const loaded: OrgProfile = {
          id: orgId,
          name: String(o?.name ?? "").trim() || "Your organization",
          mission: typeof o?.mission === "string" ? o.mission : null,
          homeState: typeof o?.homeState === "string" ? o.homeState : null,
          taxStatus: typeof o?.taxStatus === "string" ? o.taxStatus : null,
          fiscalYear: typeof o?.fiscalYear === "string" ? o.fiscalYear : null,
          crm: typeof o?.crm === "string" ? o.crm : null,
          address: typeof o?.address === "string" ? o.address : null,
          numEmployees: typeof o?.numEmployees === "number" ? o.numEmployees : null,
          foundedYear: typeof o?.foundedYear === "number" ? o.foundedYear : null,
          websiteUrl: typeof o?.websiteUrl === "string" ? o.websiteUrl : null,
          websiteConsent: typeof o?.websiteConsent === "boolean" ? o.websiteConsent : null,
        };

        setOrg(loaded);
        setOrgName(loaded.name);
      } catch (e) {
        console.error("Handbook org load error:", e);
        setOrg(null);
      } finally {
        setCheckingOrg(false);
      }
    }

    loadOrg();
  }, [user, loading]);

  async function fetchOrgDisplayName() {
    if (!user) return "";
    const idToken = await user.getIdToken();
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return "";
    return String(json?.org?.name ?? json?.orgName ?? "").trim();
  }

  useEffect(() => {
    if (!planId || !user) return;
    let cancelled = false;

    (async () => {
      setFetching(true);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load plan");
        if (cancelled) return;

        const loadedPlan: Plan = json.plan;
        setPlan(loadedPlan);

        const nameFromMe = await fetchOrgDisplayName();
        if (nameFromMe) setOrgName(nameFromMe);

        if (!nameFromMe) {
          const hb = loadedPlan?.data?.handbook ?? {};
          const legacy = String(hb?.profile?.orgName ?? "").trim();
          if (legacy) setOrgName(legacy);
        }

        const hb = loadedPlan?.data?.handbook ?? {};
        setProfileCompleted(Boolean(hb?.profileCompleted));

        const existing = hb?.sections ?? {};
        const nextState: Record<string, HandbookSectionState> = {};

        for (const s of SECTIONS) {
          const prev = existing?.[s.key] ?? {};
          const base =
            typeof prev?.base === "string" ? prev.base : BASE_TEMPLATES[s.key] ?? "";
          const contentFromOld = typeof prev?.content === "string" ? prev.content : "";
          const revealed =
            typeof prev?.revealed === "boolean"
              ? prev.revealed
              : contentFromOld.trim().length > 0;
          const started =
            typeof prev?.started === "boolean" ? prev.started : revealed;
          const typed =
            typeof prev?.typed === "boolean"
              ? prev.typed
              : Boolean(prev?.completed) && contentFromOld.trim().length > 0;

          const aiQuestions = Array.isArray(prev?.aiQuestions)
            ? (prev.aiQuestions as Question[])
            : undefined;

          nextState[s.key] = {
            base,
            content: contentFromOld,
            answers: typeof prev?.answers === "object" && prev?.answers ? prev.answers : {},
            completed: Boolean(prev?.completed),
            revealed,
            dirty: Boolean(prev?.dirty),
            started,
            typed,
            aiQuestions,
            templateHash: typeof prev?.templateHash === "string" ? prev.templateHash : undefined,
            questionsGeneratedAt:
              typeof prev?.questionsGeneratedAt === "string" ? prev.questionsGeneratedAt : undefined,
            generatedAt: typeof prev?.generatedAt === "string" ? prev.generatedAt : undefined,
          };
        }

        setSectionsState(nextState);

        const storedActive = hb?.activeKey;

        if (!hb?.profileCompleted) {
          setActiveKey(PROFILE_SECTION.key);
        } else if (
          typeof storedActive === "string" &&
          (storedActive === PROFILE_SECTION.key || storedActive in nextState)
        ) {
          setActiveKey(storedActive);
        } else {
          setActiveKey(SECTIONS[0].key);
        }
      } catch (e: any) {
        alert(e?.message || "Failed to load plan");
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [planId, user]);

  const activeSection = useMemo(() => {
    if (activeKey === PROFILE_SECTION.key) return PROFILE_SECTION;
    return SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
  }, [activeKey]);

  const completionCount = useMemo(() => {
    const vals = Object.values(sectionsState);
    if (!vals.length) return 0;
    return vals.filter((v) => v.completed).length;
  }, [sectionsState]);

  const totalSections = SECTIONS.length;

  async function saveHandbookProgress(
    nextActiveKey: string,
    nextSectionsState: Record<string, HandbookSectionState>,
    nextProfileCompleted?: boolean
  ) {
    if (!planId || !user) return;

    setSaving(true);
    setSaveMsg(null);

    try {
      const idToken = await user.getIdToken();

      const handbook = {
        ...(plan?.data?.handbook ?? {}),
        activeKey: nextActiveKey,
        profileCompleted:
          typeof nextProfileCompleted === "boolean" ? nextProfileCompleted : profileCompleted,
        sections: nextSectionsState,
      };

      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/handbook`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ handbook }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");

      setPlan((p) => (p ? { ...p, data: { ...(p.data ?? {}), handbook } } : p));
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(null), 1200);
    } catch (e: any) {
      alert(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function fetchAIQuestions(sectionKey: string) {
    if (!planId || !user)
      return {
        questions: [] as Question[],
        templateHash: undefined as string | undefined,
        questionsGeneratedAt: undefined as string | undefined,
      };

    const idToken = await user.getIdToken();
    const res = await fetch("/api/ai/handbook/section/questions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ planId, sectionKey }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Failed to generate AI prompts");
    }

    return {
      questions: Array.isArray(json.questions) ? (json.questions as Question[]) : [],
      templateHash: typeof json.templateHash === "string" ? json.templateHash : undefined,
      questionsGeneratedAt:
        typeof json.questionsGeneratedAt === "string" ? json.questionsGeneratedAt : undefined,
    };
  }

  async function generateSectionWithAI(
    sectionKey: string,
    answers: Record<string, string>,
    questions?: Question[]
  ) {
    if (!planId || !user) throw new Error("Missing planId or user");

    const idToken = await user.getIdToken();
    const res = await fetch("/api/ai/handbook/section/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        planId,
        sectionKey,
        answers,
        questions: Array.isArray(questions) ? questions : undefined,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "AI draft failed");
    }

    return {
      draftContent: String(json.draftContent ?? ""),
      templateHash: typeof json.templateHash === "string" ? json.templateHash : undefined,
      generatedAt: typeof json.generatedAt === "string" ? json.generatedAt : undefined,
    };
  }

  function updateSectionAnswer(sectionKey: string, qid: string, value: string) {
    setTypingMap((prev) => {
      if (!prev[sectionKey]) return prev;
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });

    setSectionsState((prev) => {
      const cur =
        prev[sectionKey] ??
        ({
          base: BASE_TEMPLATES[sectionKey] ?? "",
          content: "",
          answers: {},
          completed: false,
          revealed: false,
          dirty: false,
          started: false,
          typed: false,
        } as HandbookSectionState);

      return {
        ...prev,
        [sectionKey]: {
          ...cur,
          started: false,
          typed: false,
          answers: { ...(cur.answers ?? {}), [qid]: value },
        },
      };
    });
  }

  function setActiveContent(value: string) {
    setTypingMap((prev) => {
      if (!prev[activeKey]) return prev;
      const next = { ...prev };
      delete next[activeKey];
      return next;
    });

    setSectionsState((prev) => ({
      ...prev,
      [activeKey]: {
        ...(prev[activeKey] ?? {
          base: BASE_TEMPLATES[activeKey] ?? "",
          answers: {},
          completed: false,
          revealed: false,
          dirty: false,
          started: false,
          typed: false,
        }),
        content: value,
        dirty: true,
        typed: true,
      },
    }));
  }

  function goNextKey(currentKey: string) {
    if (currentKey === PROFILE_SECTION.key) return SECTIONS[0]?.key ?? PROFILE_SECTION.key;
    const idx = SECTIONS.findIndex((s) => s.key === currentKey);
    const next = SECTIONS[Math.min(idx + 1, SECTIONS.length - 1)];
    return next?.key ?? currentKey;
  }

  function goPrevKey(currentKey: string) {
    if (currentKey === PROFILE_SECTION.key) return PROFILE_SECTION.key;
    const idx = SECTIONS.findIndex((s) => s.key === currentKey);
    if (idx <= 0) return PROFILE_SECTION.key;
    return SECTIONS[idx - 1].key;
  }

  async function goNextSectionAndSave() {
    const nextKey = goNextKey(activeKey);
    await saveHandbookProgress(activeKey, sectionsState);
    setActiveKey(nextKey);
    await saveHandbookProgress(nextKey, sectionsState);
  }

  async function goPrevSectionAndSave() {
    const prevKey = goPrevKey(activeKey);
    await saveHandbookProgress(activeKey, sectionsState);
    setActiveKey(prevKey);
    await saveHandbookProgress(prevKey, sectionsState);
  }

  const activeState = activeKey === PROFILE_SECTION.key ? null : sectionsState[activeKey];
  const activeQuestions: Question[] =
    activeKey === PROFILE_SECTION.key ? [] : sectionsState[activeKey]?.aiQuestions ?? [];
  const hasQuestions = activeKey !== PROFILE_SECTION.key && activeQuestions.length > 0;
  const promptsComplete =
    activeKey === PROFILE_SECTION.key ? true : questionsCompleteWith(activeQuestions, activeState?.answers);
  const started = activeKey === PROFILE_SECTION.key ? false : Boolean(activeState?.started);

  const typing = typingMap[activeKey];
  const isTyping = Boolean(typing && !typing.done);

  useEffect(() => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }

    if (activeKey === PROFILE_SECTION.key) return;
    if (!profileCompleted) return;

    const st = sectionsState[activeKey];
    if (!st) return;

    if (!Array.isArray(st.aiQuestions) || st.aiQuestions.length === 0) return;

    const ready = questionsCompleteWith(st.aiQuestions, st.answers);
    if (!ready) return;
    if (!st.started) return;
    if (st.dirty) return;

    if (st.typed) {
      setTypingMap((prev) => {
        if (!prev[activeKey]) return prev;
        const n = { ...prev };
        delete n[activeKey];
        return n;
      });
      return;
    }

    if (!st.content || st.content.trim().length === 0) return;

    if (!st.revealed) {
      setSectionsState((prev) => ({
        ...prev,
        [activeKey]: { ...(prev[activeKey] as HandbookSectionState), revealed: true },
      }));
    }

    const existingTyping = typingMap[activeKey];
    if (existingTyping?.done) return;

    if (!existingTyping) {
      const tokens = wordTokens(st.content);
      setTypingMap((prev) => ({
        ...prev,
        [activeKey]: { tokens, idx: 0, display: "", done: tokens.length === 0 },
      }));
    }

    const start = () => {
      typingIntervalRef.current = setInterval(() => {
        setTypingMap((prev) => {
          const cur = prev[activeKey];
          if (!cur || cur.done) return prev;

          const nextIdx = cur.idx + 1;
          const nextDisplay = cur.display + (cur.tokens[cur.idx] ?? "");
          const done = nextIdx >= cur.tokens.length;

          return {
            ...prev,
            [activeKey]: { ...cur, idx: nextIdx, display: nextDisplay, done },
          };
        });
      }, 35);
    };

    const t = setTimeout(start, 0);

    return () => {
      clearTimeout(t);
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
        typingIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, profileCompleted, sectionsState, typingMap]);

  const orgDisplayName = (org?.name || orgName || "").trim() || "Your organization";
  const avatarText = initialsFromName(orgDisplayName);

  async function downloadHandbook(format: "pdf" | "docx") {
    if (!planId || !user) return;
    setExporting(format);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/handbook/export/${format}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Export failed");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || `handbook.${format}`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message || "Export failed");
    } finally {
      setExporting(null);
    }
  }

  async function approveHandbook() {
    if (!planId || !user) return;
    setApproving(true);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Approve failed");

      setPlan((p) =>
        p
          ? {
              ...p,
              status: "approved",
              data: {
                ...(p.data ?? {}),
                handbook: {
                  ...(p.data?.handbook ?? {}),
                  approvedAt: new Date().toISOString(),
                  approvedBy: { email: user.email ?? null },
                },
              },
            }
          : p
      );

      alert("Handbook approved.");
    } catch (e: any) {
      alert(e?.message || "Approve failed");
    } finally {
      setApproving(false);
    }
  }

  useEffect(() => {
    if (activeKey === PROFILE_SECTION.key) return;
    const t = typingMap[activeKey];
    if (!t || !t.done) return;

    const st = sectionsState[activeKey];
    if (!st) return;
    if (st.dirty) return;
    if (st.typed) return;

    setSectionsState((prev) => ({
      ...prev,
      [activeKey]: { ...(prev[activeKey] as HandbookSectionState), typed: true },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, typingMap, sectionsState]);

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

  if (!planId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-50 p-6">
        <div className="max-w-lg rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-slate-900">Fund Development Handbook Template</h1>
          <p className="mt-3 text-slate-600">
            Missing <span className="font-semibold">planId</span>. Please return to Products and start again.
          </p>
          <button
            className="mt-6 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition"
            onClick={() => router.push("/products")}
          >
            Back to Products
          </button>
        </div>
      </main>
    );
  }

  const canAccessSections = profileCompleted;

  const draftValue =
    activeKey === PROFILE_SECTION.key
      ? ""
      : activeState?.typed
      ? activeState?.content ?? ""
      : typingMap[activeKey]?.display ?? activeState?.content ?? "";

  const showQuestionsPanel =
    activeKey !== PROFILE_SECTION.key &&
    Array.isArray(sectionsState[activeKey]?.aiQuestions) &&
    (sectionsState[activeKey]?.aiQuestions?.length ?? 0) > 0 &&
    !started;

  const showDraft = activeKey !== PROFILE_SECTION.key && started && promptsComplete;

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-lg">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Fund Development Handbook Builder</h1>
              <p className="mt-2 text-sm text-slate-600">
                Generate questions → answer → create section → review → complete.
              </p>
            </div>

            {/* Right side: Progress + Profile Icon */}
            <div className="flex items-start justify-between gap-3 md:justify-end">
              <div className="rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold text-slate-600">Progress</div>
                <div className="mt-1 text-sm text-slate-800">
                  <span className="font-semibold">{completionCount}</span> / {totalSections} sections complete
                </div>
                <div className="mt-2 h-2 w-64 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-success-400 transition-all"
                    style={{
                      width: `${Math.round((completionCount / Math.max(totalSections, 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Profile icon + popover */}
              <div className="relative">
                <button
                  ref={profileBtnRef}
                  type="button"
                  aria-label="Open profile"
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-400 text-sm font-semibold text-white shadow-lg hover:shadow-xl hover:from-primary-600 hover:to-primary-500 transition-all"
                  onClick={() => setProfileOpen((v) => !v)}
                >
                  {avatarText}
                </button>

                {profileOpen ? (
                  <div
                    ref={profilePopoverRef}
                    className="absolute right-0 z-50 mt-2 w-[380px] overflow-hidden rounded-2xl border-2 border-primary-100 bg-white shadow-2xl"
                  >
                    {/* Header */}
                    <div className="bg-gradient-to-br from-primary-500 via-primary-500 to-accent-400 p-4 text-white">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-sm font-bold backdrop-blur-sm">
                            {avatarText}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">
                              {orgDisplayName}
                            </div>
                            <div className="mt-0.5 text-xs text-white/80 truncate">
                              Signed in as{" "}
                              <span className="font-medium">
                                {user?.email ?? "Unknown"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="rounded-lg bg-white/15 px-2 py-1 text-xs text-white hover:bg-white/20 border border-white/20 transition"
                          onClick={() => setProfileOpen(false)}
                        >
                          Close
                        </button>
                      </div>

                      {/* Mission preview */}
                      <div className="mt-3 rounded-xl bg-white/15 backdrop-blur-sm p-3 border border-white/20">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="h-2 w-2 rounded-full bg-success-300" />
                          <div className="text-xs font-bold text-white/90">
                            Mission
                          </div>
                        </div>
                        <div className="text-sm leading-relaxed">
                          {org?.mission?.trim() ? org.mission : "Not provided yet."}
                        </div>
                      </div>

                      {/* Org info toggle */}
                      <button
                        type="button"
                        className="mt-3 w-full rounded-xl bg-white/15 backdrop-blur-sm px-3 py-2.5 text-left hover:bg-white/20 transition border border-white/20"
                        onClick={() => setOrgInfoOpen((v) => !v)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-accent-300" />
                            <div className="text-sm font-bold">Organization info</div>
                          </div>
                          <div className="text-sm font-bold">{orgInfoOpen ? "−" : "+"}</div>
                        </div>
                      </button>
                    </div>

                    {/* Expanded org info */}
                    {orgInfoOpen ? (
                      <div className="p-4 bg-white">
                        <div className="space-y-2 text-sm">
                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                            <div className="text-xs font-semibold text-slate-600">
                              Home state
                            </div>
                            <div className="mt-1 font-medium text-slate-900">
                              {org?.homeState?.trim() ? org.homeState : "—"}
                            </div>
                          </div>

                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                            <div className="text-xs font-semibold text-slate-600">
                              Tax status
                            </div>
                            <div className="mt-1 font-medium text-slate-900">
                              {org?.taxStatus?.trim() ? org.taxStatus : "—"}
                            </div>
                          </div>

                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                            <div className="text-xs font-semibold text-slate-600">
                              Fiscal year
                            </div>
                            <div className="mt-1 font-medium text-slate-900">
                              {org?.fiscalYear?.trim() ? org.fiscalYear : "—"}
                            </div>
                          </div>

                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                            <div className="text-xs font-semibold text-slate-600">CRM</div>
                            <div className="mt-1 font-medium text-slate-900">
                              {org?.crm?.trim() ? org.crm : "—"}
                            </div>
                          </div>

                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                            <div className="text-xs font-semibold text-slate-600">
                              Address
                            </div>
                            <div className="mt-1 font-medium text-slate-900">
                              {org?.address?.trim() ? org.address : "—"}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                              <div className="text-xs font-semibold text-slate-600">
                                Employees
                              </div>
                              <div className="mt-1 font-medium text-slate-900">
                                {typeof org?.numEmployees === "number"
                                  ? org.numEmployees
                                  : "—"}
                              </div>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                              <div className="text-xs font-semibold text-slate-600">
                                Founded
                              </div>
                              <div className="mt-1 font-medium text-slate-900">
                                {typeof org?.foundedYear === "number"
                                  ? org.foundedYear
                                  : "—"}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                            <div className="text-xs font-semibold text-slate-600">
                              Website
                            </div>
                            <div className="mt-1 font-medium text-slate-900 break-all">
                              {org?.websiteConsent && org?.websiteUrl
                                ? org.websiteUrl
                                : "—"}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              {org?.websiteUrl
                                ? org?.websiteConsent
                                  ? "✓ Consent granted"
                                  : "Consent not granted"
                                : "No website provided"}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Footer actions */}
                    <div className="p-4 border-t border-slate-200 bg-white">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition"
                          onClick={() => {
                            setProfileOpen(false);
                            router.push("/dashboard");
                          }}
                        >
                          Return home
                        </button>

                        <button
                          type="button"
                          className="w-full rounded-xl bg-slate-900 px-3 py-2 text-left text-sm font-medium text-white hover:bg-slate-800 transition"
                          onClick={async () => {
                            await signOut(auth);
                            router.push("/login");
                          }}
                        >
                          Sign out
                        </button>

                        {/* Optional subtle status line */}
                        <div className="pt-1 text-xs text-slate-500">
                          {checkingOrg ? "Loading organization..." : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {/* Left nav */}
            <div className="md:col-span-1">
              <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-900">Contents</div>
                <div className="mt-3 space-y-2">
                  {ALL_NAV.map((s) => {
                    const active = s.key === activeKey;
                    const isProfile = s.key === PROFILE_SECTION.key;
                    const done = isProfile ? profileCompleted : Boolean(sectionsState[s.key]?.completed);
                    const locked = !isProfile && !canAccessSections;

                    return (
                      <button
                        key={s.key}
                        type="button"
                        className={classNames(
                          "w-full rounded-xl border-2 px-3 py-2 text-left transition",
                          locked ? "opacity-50 cursor-not-allowed" : "",
                          active 
                            ? "border-slate-900 bg-slate-50" 
                            : "border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300"
                        )}
                        onClick={() => {
                          if (locked) return;
                          setActiveKey(s.key);
                        }}
                        disabled={locked}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">{s.title}</div>
                            {locked ? (
                              <div className="mt-0.5 text-xs text-slate-600">Complete section 0 to unlock</div>
                            ) : null}
                          </div>
                          <div
                            className={classNames(
                              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition",
                              done ? "bg-success-400 text-white" : "bg-slate-200 text-slate-700"
                            )}
                            title={done ? "Complete" : "Not complete"}
                          >
                            {done ? "✓" : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition"
                    onClick={() => router.push(`/plans/${encodeURIComponent(planId)}`)}
                  >
                    Back to plan
                  </button>

                  <button
                    className={classNames(
                      "rounded-xl px-3 py-2 text-sm font-medium text-white transition",
                      saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
                    )}
                    disabled={saving}
                    onClick={() => saveHandbookProgress(activeKey, sectionsState)}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>

                  {saveMsg ? (
                    <span className="px-2 py-2 text-sm font-semibold text-success-500">{saveMsg}</span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Main content */}
            <div className="md:col-span-2">
              <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
                {fetching ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 mb-4 shadow-lg">
                        <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      </div>
                      <p className="text-sm text-slate-600 font-medium">Loading handbook...</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* SECTION 0 (Kickoff / Explanation) */}
                    {activeKey === PROFILE_SECTION.key ? (
                      <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-6">
                        <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Section 0</div>

                        <h2 className="mt-2 text-2xl font-bold text-slate-900">
                          {(orgName || "Your organization").trim()} Fund Development Handbook
                        </h2>

                        <p className="mt-3 text-sm text-slate-700 leading-relaxed">
                          You'll build your handbook one section at a time. For each section, the AI will:
                        </p>

                        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                          <li>Generate a small set of questions (up to 10) based on what it still needs.</li>
                          <li>You answer the questions.</li>
                          <li>AI drafts the section in your template format, then you review and edit.</li>
                        </ol>

                        <div className="mt-4 rounded-xl border-2 border-primary-200 bg-primary-50 p-4">
                          <div className="text-sm font-semibold text-primary-700">Website permission</div>
                          <p className="mt-1 text-sm text-primary-600">
                            If you provided your website and granted permission during onboarding, the AI may use publicly
                            available information from your site to reduce the number of questions it asks.
                          </p>
                        </div>

                        <div className="mt-6 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className={classNames(
                              "rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition",
                              saving ? "bg-slate-400 cursor-not-allowed" : "bg-success-400 hover:bg-success-500 shadow-lg"
                            )}
                            disabled={saving}
                            onClick={async () => {
                              const nextKey = SECTIONS[0]?.key ?? PROFILE_SECTION.key;
                              setProfileCompleted(true);
                              setActiveKey(nextKey);
                              await saveHandbookProgress(nextKey, sectionsState, true);
                            }}
                          >
                            {saving ? "Saving..." : "Complete section"}
                          </button>

                          <span className="text-xs text-slate-600 font-medium">This unlocks the rest of the handbook sections.</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Section header */}
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h2 className="text-xl font-bold text-slate-900">{activeSection.title}</h2>
                            <p className="mt-1 text-sm text-slate-600">
                              Step 1: Generate questions • Step 2: Answer • Step 3: Create section
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition"
                              onClick={goPrevSectionAndSave}
                            >
                              Back
                            </button>
                            <button
                              className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition"
                              onClick={goNextSectionAndSave}
                            >
                              Next
                            </button>
                          </div>
                        </div>

                        {/* AI-only CTA (no hardcoded prompts) */}
                        {!hasQuestions && !started ? (
                          <div className="mt-5 rounded-xl border-2 border-slate-200 bg-slate-50 p-5">
                            <div className="text-sm font-bold text-slate-900">No questions yet</div>
                            <p className="mt-1 text-sm text-slate-700">
                              Click below to have AI generate the questions needed for this section.
                            </p>
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className={classNames(
                                  "rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition",
                                  saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800 shadow-lg"
                                )}
                                disabled={saving}
                                onClick={async () => {
                                  try {
                                    const { questions, templateHash, questionsGeneratedAt } = await fetchAIQuestions(
                                      activeKey
                                    );

                                    const cur =
                                      sectionsState[activeKey] ??
                                      ({
                                        base: BASE_TEMPLATES[activeKey] ?? "",
                                        content: "",
                                        answers: {},
                                        completed: false,
                                        revealed: false,
                                        dirty: false,
                                        started: false,
                                        typed: false,
                                      } as HandbookSectionState);

                                    const next = {
                                      ...sectionsState,
                                      [activeKey]: {
                                        ...cur,
                                        aiQuestions: questions,
                                        templateHash,
                                        questionsGeneratedAt,
                                        started: false,
                                        typed: false,
                                      },
                                    };

                                    setSectionsState(next);
                                    await saveHandbookProgress(activeKey, next);
                                  } catch (e: any) {
                                    alert(e?.message || "Failed to generate AI questions");
                                  }
                                }}
                              >
                                Ask questions with AI
                              </button>
                              <div className="text-xs text-slate-600">AI will generate up to 10 questions (only what it needs).</div>
                            </div>
                          </div>
                        ) : null}

                        {/* Prompts panel (AI-only) */}
                        {showQuestionsPanel ? (
                          <div className="mt-5 rounded-xl border-2 border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <div className="text-sm font-bold text-slate-900">AI questions</div>
                                <div className="mt-1 text-xs text-slate-600">
                                  Answer all required questions, then click Generate section below.
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className={classNames(
                                    "rounded-xl px-3 py-2 text-sm font-semibold text-white transition",
                                    saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800 shadow-lg"
                                  )}
                                  disabled={saving}
                                  onClick={async () => {
                                    try {
                                      const { questions, templateHash, questionsGeneratedAt } = await fetchAIQuestions(
                                        activeKey
                                      );
                                      const cur = sectionsState[activeKey];
                                      if (!cur) return;

                                      const next = {
                                        ...sectionsState,
                                        [activeKey]: {
                                          ...cur,
                                          aiQuestions: questions,
                                          templateHash,
                                          questionsGeneratedAt,
                                          started: false,
                                          typed: false,
                                        },
                                      };

                                      setSectionsState(next);
                                      await saveHandbookProgress(activeKey, next);
                                    } catch (e: any) {
                                      alert(e?.message || "Failed to regenerate questions");
                                    }
                                  }}
                                >
                                  Regenerate questions
                                </button>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                              {activeQuestions.map((q) => {
                                const isMultiSelect = q.type === "multiselect";
                                const hasOtherOption = Array.isArray(q.options) && q.options.includes("Other");
                                const val = activeState?.answers?.[q.id] ?? "";
                                let multiVals: string[] = [];
                                if (isMultiSelect) {
                                  multiVals = parseMulti(String(val || "[]"));
                                }
                                const isSelect = q.type === "select";
                                const otherKey = `${q.id}__other`;
                                const otherVal = activeState?.answers?.[otherKey] ?? "";
                                const showOtherBox =
                                  (isSelect && hasOtherOption && val === "Other") ||
                                  (isMultiSelect && hasOtherOption && multiVals.includes("Other"));
                                const isTextarea = q.type === "textarea";

                                return (
                                  <div key={q.id} className={isTextarea ? "sm:col-span-2" : ""}>
                                    <label className="text-sm font-semibold text-slate-900">
                                      {q.label}
                                      {q.required ? <span className="text-rose-600"> *</span> : null}
                                    </label>
                                    {q.helper ? <div className="mt-1 text-xs text-slate-600">{q.helper}</div> : null}

                                    {isSelect ? (
                                      <select
                                        className="mt-2 w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition"
                                        value={val}
                                        onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
                                      >
                                        <option value="">{q.placeholder ?? "Select one"}</option>
                                        {(q.options ?? []).map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    ) : isMultiSelect ? (
                                      <div className="mt-2 space-y-2 rounded-xl border-2 border-slate-200 bg-white p-3">
                                        {(q.options ?? []).map((opt) => {
                                          const checked = multiVals.includes(opt);
                                          return (
                                            <label key={opt} className="flex items-center gap-2 text-sm text-slate-900">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                className="rounded border-slate-300 text-primary-500 focus:ring-primary-500"
                                                onChange={(e) => {
                                                  const next = e.target.checked
                                                    ? Array.from(new Set([...multiVals, opt]))
                                                    : multiVals.filter((x) => x !== opt);
                                                  updateSectionAnswer(activeKey, q.id, JSON.stringify(next));
                                                }}
                                              />
                                              <span>{opt}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    ) : isTextarea ? (
                                      <textarea
                                        className="mt-2 min-h-[110px] w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition"
                                        placeholder={q.placeholder}
                                        value={val}
                                        onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
                                      />
                                    ) : (
                                      <input
                                        className="mt-2 w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition"
                                        placeholder={q.placeholder}
                                        value={val}
                                        onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
                                      />
                                    )}

                                    {showOtherBox ? (
                                      <textarea
                                        className="mt-2 min-h-[90px] w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition"
                                        placeholder="Please specify..."
                                        value={otherVal}
                                        onChange={(e) => updateSectionAnswer(activeKey, otherKey, e.target.value)}
                                      />
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Generate section button at bottom */}
                            <div className="mt-6 flex flex-col items-center gap-3">
                              {generating ? (
                                <div className="flex items-center gap-2 text-slate-700">
                                  <span className="text-sm font-semibold">Thinking</span>
                                  <div className="flex gap-1">
                                    <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                                    <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                                    <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={classNames(
                                    "rounded-xl px-6 py-3 text-base font-bold text-white transition",
                                    !promptsComplete
                                      ? "bg-slate-300 cursor-not-allowed"
                                      : "bg-success-400 hover:bg-success-500 shadow-lg"
                                  )}
                                  disabled={!promptsComplete}
                                  onClick={async () => {
                                    const st = sectionsState[activeKey];
                                    if (!st) return;

                                    try {
                                      setGenerating(true);
                                      setTypingMap((prev) => {
                                        const n = { ...prev };
                                        delete n[activeKey];
                                        return n;
                                      });

                                      const { draftContent, templateHash, generatedAt } = await generateSectionWithAI(
                                        activeKey,
                                        st.answers,
                                        st.aiQuestions
                                      );

                                      const next = {
                                        ...sectionsState,
                                        [activeKey]: {
                                          ...st,
                                          content: draftContent,
                                          revealed: true,
                                          started: true,
                                          typed: false,
                                          dirty: false,
                                          templateHash: templateHash ?? st.templateHash,
                                          generatedAt,
                                        },
                                      };

                                      setSectionsState(next);
                                      await saveHandbookProgress(activeKey, next);
                                    } catch (e: any) {
                                      alert(e?.message || "Failed to generate section");
                                    } finally {
                                      setGenerating(false);
                                    }
                                  }}
                                >
                                  Generate section
                                </button>
                              )}
                              {!promptsComplete && (
                                <div className="text-xs text-slate-600">
                                  Please answer all required questions to continue
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}

                        {/* Draft area */}
                        <div className="mt-5">
                          <label className="text-sm font-semibold text-slate-900">Section text</label>

                          {!showDraft ? (
                            <div className="mt-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                              <div className="text-sm font-bold text-slate-900">Hidden until you generate</div>
                              <p className="mt-1 text-sm text-slate-700">
                                Ask questions, answer them, then click <span className="font-semibold">Generate section</span>.
                              </p>
                            </div>
                          ) : (
                            <div className="relative">
                              <textarea
                                className="mt-2 min-h-[320px] w-full rounded-xl border-2 border-slate-200 bg-white p-4 text-sm text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition disabled:bg-slate-50"
                                value={draftValue}
                                onChange={(e) => setActiveContent(e.target.value)}
                                disabled={isTyping}
                              />
                              {isTyping ? (
                                <div className="absolute right-3 top-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
                                  Writing…
                                </div>
                              ) : null}
                            </div>
                          )}

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-xs text-slate-600 font-medium">
                              {isTyping ? "Please wait while the section finishes writing." : "You can edit once writing finishes."}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                className={classNames(
                                  "rounded-xl px-4 py-2 text-sm font-semibold text-white transition",
                                  saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800 shadow-lg"
                                )}
                                disabled={saving}
                                onClick={() => saveHandbookProgress(activeKey, sectionsState)}
                              >
                                {saving ? "Saving..." : "Save"}
                              </button>

                              <button
                                className={classNames(
                                  "rounded-xl px-4 py-2 text-sm font-semibold text-white transition",
                                  showDraft && !isTyping && (activeState?.content ?? "").trim().length >= 50
                                    ? "bg-success-400 hover:bg-success-500 shadow-lg"
                                    : "bg-slate-300 cursor-not-allowed"
                                )}
                                disabled={!showDraft || isTyping || (activeState?.content ?? "").trim().length < 50}
                                onClick={async () => {
                                  const cur = sectionsState[activeKey];
                                  if (!cur) return;

                                  const next = {
                                    ...sectionsState,
                                    [activeKey]: { ...cur, completed: true, typed: true },
                                  };

                                  setSectionsState(next);

                                  const nextKey = goNextKey(activeKey);
                                  setActiveKey(nextKey);
                                  await saveHandbookProgress(nextKey, next);
                                }}
                              >
                                Complete section
                              </button>

                              <button
                                className="rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition"
                                onClick={async () => {
                                  const cur = sectionsState[activeKey];
                                  if (!cur) return;

                                  const next = { ...sectionsState, [activeKey]: { ...cur, completed: false } };
                                  setSectionsState(next);
                                  await saveHandbookProgress(activeKey, next);
                                }}
                              >
                                Mark incomplete
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Floating download/save button - bottom right */}
          <div className="fixed bottom-6 right-6 z-40">
            <button
              type="button"
              onClick={() => setDownloadModalOpen(true)}
              className="rounded-xl bg-gradient-to-r from-primary-500 to-accent-400 px-5 py-3 text-sm font-bold text-white hover:from-primary-600 hover:to-primary-500 shadow-2xl hover:shadow-primary-500/50 transition-all"
            >
              Download & Save Handbook
            </button>
          </div>

          {/* Download/Approve Modal */}
          {downloadModalOpen ? (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50"
                onClick={() => setDownloadModalOpen(false)}
              />

              {/* Modal */}
              <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                <div className="w-full max-w-2xl rounded-2xl border-2 border-slate-200 bg-white shadow-2xl">
                  <div className="border-b-2 border-slate-200 bg-gradient-to-r from-primary-50 to-primary-50 px-6 py-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-slate-900">Download & Save Handbook</h3>
                      <button
                        type="button"
                        onClick={() => setDownloadModalOpen(false)}
                        className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 border-2 border-slate-200 transition"
                      >
                        Close
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      Exports the latest saved content (including incomplete sections).
                    </p>
                  </div>

                  <div className="p-6">
                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        className={classNames(
                          "rounded-xl px-5 py-3 text-sm font-semibold text-white transition w-full",
                          exporting ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800 shadow-lg"
                        )}
                        disabled={Boolean(exporting)}
                        onClick={() => downloadHandbook("pdf")}
                      >
                        {exporting === "pdf" ? "Generating PDF..." : "Download PDF"}
                      </button>

                      <button
                        type="button"
                        className={classNames(
                          "rounded-xl px-5 py-3 text-sm font-semibold text-white transition w-full",
                          exporting ? "bg-slate-400 cursor-not-allowed" : "bg-success-400 hover:bg-success-500 shadow-lg"
                        )}
                        disabled={Boolean(exporting)}
                        onClick={() => downloadHandbook("docx")}
                      >
                        {exporting === "docx" ? "Generating Word..." : "Download Word (.docx)"}
                      </button>

                      <div className="my-3 border-t-2 border-slate-200"></div>

                      <button
                        type="button"
                        className={classNames(
                          "rounded-xl px-5 py-3 text-sm font-semibold text-white transition w-full",
                          approving ? "bg-slate-400 cursor-not-allowed" : "bg-gradient-to-r from-primary-500 to-accent-400 hover:from-primary-600 hover:to-primary-500 shadow-lg shadow-primary-500/30"
                        )}
                        disabled={approving}
                        onClick={approveHandbook}
                      >
                        {approving ? "Approving..." : "Approve Handbook"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          <div className="mt-4 rounded-xl bg-primary-50 border-2 border-primary-200 px-4 py-3">
            <p className="text-xs text-primary-600 font-medium">
              💡 AI-powered workflow: Generate questions → Answer → Create section → Review/edit → Save/complete. 
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}




// "use client";

// import { useEffect, useMemo, useRef, useState } from "react";
// import { useRouter, useSearchParams } from "next/navigation";
// import { signOut } from "firebase/auth";
// import { auth } from "@/lib/firebaseClient";
// import { useAuth } from "@/lib/AuthContext";
// import { BASE_TEMPLATES } from "@/lib/handbookTemplates";

// type Section = {
//   key: string;
//   title: string;
//   order: number;
// };

// type Plan = {
//   id: string;
//   title?: string;
//   templateType?: string;
//   data?: any;
//   status?: string;
// };

// type Question = {
//   id: string;
//   label: string;
//   helper?: string;
//   placeholder?: string;
//   type?: "text" | "textarea" | "select" | "multiselect";
//   options?: string[];
//   required?: boolean;
// };

// type HandbookSectionState = {
//   base: string;
//   content: string;
//   answers: Record<string, string>;
//   completed: boolean;
//   revealed: boolean;
//   dirty: boolean;
//   started: boolean;
//   typed: boolean;
//   aiQuestions?: Question[];
//   templateHash?: string;
//   questionsGeneratedAt?: string;
//   generatedAt?: string;
// };

// const PROFILE_SECTION: Section = {
//   key: "s0_profile",
//   title: "0. Base informational questions",
//   order: 0,
// };

// const SECTIONS: Section[] = [
//   { key: "s1_intro", title: "1. Introduction and Purpose", order: 1 },
//   { key: "s2_philosophy", title: "2. Fund Development Philosophy and Definitions", order: 2 },
//   { key: "s3_roles", title: "3. Roles and Responsibilities", order: 3 },
//   { key: "s4_ethics", title: "4. Ethical Fundraising Framework", order: 4 },
//   { key: "s5_gift_acceptance", title: "5. Gift Acceptance Policy", order: 5 },
//   { key: "s5a_major_gifts", title: "5A. Major Gifts Acceptance Policy", order: 6 },
//   { key: "s6_processing", title: "6. Gift Processing Policies and Procedures", order: 7 },
//   { key: "s7_recognition", title: "7. Donor Recognition and Acknowledgement", order: 8 },
//   { key: "s8_stewardship", title: "8. Donor Cultivation and Stewardship", order: 9 },
//   { key: "s9_grants", title: "9. Grants Management", order: 10 },
//   { key: "s10_awards_declines", title: "10. Funding Announcements and Declinations", order: 11 },
//   { key: "s11_sponsorships", title: "11. Corporate Sponsorships", order: 12 },
//   { key: "s12_events", title: "12. Special Events Fundraising", order: 13 },
//   { key: "s13_inkind", title: "13. In-Kind Donations", order: 14 },
//   { key: "s14_planned_giving", title: "14. Legacy and Planned Giving", order: 15 },
//   { key: "s15_financial", title: "15. Financial Management and Reporting", order: 16 },
//   { key: "s16_compliance", title: "16. Compliance, Governance, and Accountability", order: 17 },
//   { key: "s17_appendices", title: "17. Appendices and Attachments", order: 18 },
// ];

// const ALL_NAV: Section[] = [PROFILE_SECTION, ...SECTIONS];

// function classNames(...xs: Array<string | false | undefined | null>) {
//   return xs.filter(Boolean).join(" ");
// }

// function wordTokens(full: string) {
//   return full.match(/\S+\s*/g) ?? [];
// }

// function parseMulti(raw: string): string[] {
//   try {
//     const parsed = JSON.parse(raw);
//     return Array.isArray(parsed) ? parsed.map(String) : [];
//   } catch {
//     return raw
//       .split(",")
//       .map((s) => s.trim())
//       .filter(Boolean);
//   }
// }

// function questionsCompleteWith(qs: Question[], answers?: Record<string, string>) {
//   if (!qs || qs.length === 0) return true;
//   const ans = answers ?? {};

//   return qs.every((q) => {
//     const required = q.required !== false;
//     if (!required) return true;

//     const raw = String(ans[q.id] ?? "").trim();
//     if (!raw) return false;

//     const otherKey = `${q.id}__other`;
//     const otherText = String(ans[otherKey] ?? "").trim();
//     const hasOtherOption = Array.isArray(q.options) && q.options.includes("Other");

//     if (q.type === "multiselect") {
//       const vals = parseMulti(raw);
//       if (vals.length === 0) return false;
//       if (hasOtherOption && vals.includes("Other")) return otherText.length > 0;
//       return true;
//     }

//     // select/text/textarea
//     if (hasOtherOption && raw === "Other") return otherText.length > 0;

//     // Optional: if label includes "please explain", require a detail box always
//     // (only do this if you actually want that behavior)
//     // const needsExplain = /please explain|explain/i.test(q.label);
//     // if (needsExplain) return otherText.length > 0;

//     return true;
//   });
// }

// function initialsFromName(name?: string) {
//   const n = String(name ?? "").trim();
//   if (!n) return "O";
//   const parts = n.split(/\s+/).filter(Boolean);
//   const a = parts[0]?.[0] ?? "O";
//   const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
//   return (a + b).toUpperCase();
// }

// type TypingState = {
//   tokens: string[];
//   idx: number;
//   display: string;
//   done: boolean;
// };

// export default function FundDevHandbookTemplatePage() {
//   const router = useRouter();
//   const params = useSearchParams();
//   const planId = params.get("planId");
//   const { user, loading } = useAuth();

//   const [plan, setPlan] = useState<Plan | null>(null);
//   const [fetching, setFetching] = useState(true);
//   const [saving, setSaving] = useState(false);
//   const [saveMsg, setSaveMsg] = useState<string | null>(null);

//   const [activeKey, setActiveKey] = useState<string>(PROFILE_SECTION.key);

//   const [orgName, setOrgName] = useState<string>("");

//   const [profileCompleted, setProfileCompleted] = useState<boolean>(false);

//   const [sectionsState, setSectionsState] = useState<Record<string, HandbookSectionState>>({});

//   const [typingMap, setTypingMap] = useState<Record<string, TypingState>>({});
//   const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);

//   // Profile popover state
//   const [profileOpen, setProfileOpen] = useState(false);
//   const profileBtnRef = useRef<HTMLButtonElement | null>(null);
//   const profilePopoverRef = useRef<HTMLDivElement | null>(null);

//   const [exporting, setExporting] = useState<null | "pdf" | "docx">(null);
//   const [approving, setApproving] = useState(false);

//   useEffect(() => {
//     if (!loading && !user) router.push("/login");
//   }, [user, loading, router]);

//   async function fetchOrgDisplayName() {
//     if (!user) return "";
//     const idToken = await user.getIdToken();
//     const res = await fetch("/api/me", {
//       headers: { Authorization: `Bearer ${idToken}` },
//     });
//     const json = await res.json().catch(() => ({}));
//     if (!res.ok) return "";
//     return String(json?.org?.name ?? json?.orgName ?? "").trim();
//   }

//   useEffect(() => {
//     if (!planId || !user) return;
//     let cancelled = false;

//     (async () => {
//       setFetching(true);
//       try {
//         const idToken = await user.getIdToken();
//         const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`, {
//           headers: { Authorization: `Bearer ${idToken}` },
//         });
//         const json = await res.json();
//         if (!res.ok) throw new Error(json?.error || "Failed to load plan");
//         if (cancelled) return;

//         const loadedPlan: Plan = json.plan;
//         setPlan(loadedPlan);

//         const nameFromMe = await fetchOrgDisplayName();
//         if (nameFromMe) setOrgName(nameFromMe);

//         if (!nameFromMe) {
//           const hb = loadedPlan?.data?.handbook ?? {};
//           const legacy = String(hb?.profile?.orgName ?? "").trim();
//           if (legacy) setOrgName(legacy);
//         }

//         const hb = loadedPlan?.data?.handbook ?? {};
//         setProfileCompleted(Boolean(hb?.profileCompleted));

//         const existing = hb?.sections ?? {};
//         const nextState: Record<string, HandbookSectionState> = {};

//         for (const s of SECTIONS) {
//           const prev = existing?.[s.key] ?? {};
//           const base =
//             typeof prev?.base === "string" ? prev.base : BASE_TEMPLATES[s.key] ?? "";
//           const contentFromOld = typeof prev?.content === "string" ? prev.content : "";
//           const revealed =
//             typeof prev?.revealed === "boolean"
//               ? prev.revealed
//               : contentFromOld.trim().length > 0;
//           const started =
//             typeof prev?.started === "boolean" ? prev.started : revealed;
//           const typed =
//             typeof prev?.typed === "boolean"
//               ? prev.typed
//               : Boolean(prev?.completed) && contentFromOld.trim().length > 0;

//           const aiQuestions = Array.isArray(prev?.aiQuestions)
//             ? (prev.aiQuestions as Question[])
//             : undefined;

//           nextState[s.key] = {
//             base,
//             content: contentFromOld,
//             answers: typeof prev?.answers === "object" && prev?.answers ? prev.answers : {},
//             completed: Boolean(prev?.completed),
//             revealed,
//             dirty: Boolean(prev?.dirty),
//             started,
//             typed,
//             aiQuestions,
//             templateHash: typeof prev?.templateHash === "string" ? prev.templateHash : undefined,
//             questionsGeneratedAt:
//               typeof prev?.questionsGeneratedAt === "string" ? prev.questionsGeneratedAt : undefined,
//             generatedAt: typeof prev?.generatedAt === "string" ? prev.generatedAt : undefined,
//           };
//         }

//         setSectionsState(nextState);

//         const storedActive = hb?.activeKey;

//         if (!hb?.profileCompleted) {
//           setActiveKey(PROFILE_SECTION.key);
//         } else if (
//           typeof storedActive === "string" &&
//           (storedActive === PROFILE_SECTION.key || storedActive in nextState)
//         ) {
//           setActiveKey(storedActive);
//         } else {
//           setActiveKey(SECTIONS[0].key);
//         }
//       } catch (e: any) {
//         alert(e?.message || "Failed to load plan");
//       } finally {
//         if (!cancelled) setFetching(false);
//       }
//     })();

//     return () => {
//       cancelled = true;
//     };
//   }, [planId, user]);

//   const activeSection = useMemo(() => {
//     if (activeKey === PROFILE_SECTION.key) return PROFILE_SECTION;
//     return SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
//   }, [activeKey]);

//   const completionCount = useMemo(() => {
//     const vals = Object.values(sectionsState);
//     if (!vals.length) return 0;
//     return vals.filter((v) => v.completed).length;
//   }, [sectionsState]);

//   const totalSections = SECTIONS.length;

//   async function saveHandbookProgress(
//     nextActiveKey: string,
//     nextSectionsState: Record<string, HandbookSectionState>,
//     nextProfileCompleted?: boolean
//   ) {
//     if (!planId || !user) return;

//     setSaving(true);
//     setSaveMsg(null);

//     try {
//       const idToken = await user.getIdToken();

//       const handbook = {
//         ...(plan?.data?.handbook ?? {}),
//         activeKey: nextActiveKey,
//         profileCompleted:
//           typeof nextProfileCompleted === "boolean" ? nextProfileCompleted : profileCompleted,
//         sections: nextSectionsState,
//       };

//       const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/handbook`, {
//         method: "PATCH",
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${idToken}`,
//         },
//         body: JSON.stringify({ handbook }),
//       });

//       const json = await res.json().catch(() => ({}));
//       if (!res.ok) throw new Error(json?.error || "Save failed");

//       setPlan((p) => (p ? { ...p, data: { ...(p.data ?? {}), handbook } } : p));
//       setSaveMsg("Saved");
//       setTimeout(() => setSaveMsg(null), 1200);
//     } catch (e: any) {
//       alert(e?.message || "Save failed");
//     } finally {
//       setSaving(false);
//     }
//   }

//   async function fetchAIQuestions(sectionKey: string) {
//     if (!planId || !user)
//       return {
//         questions: [] as Question[],
//         templateHash: undefined as string | undefined,
//         questionsGeneratedAt: undefined as string | undefined,
//       };

//     const idToken = await user.getIdToken();
//     const res = await fetch("/api/ai/handbook/section/questions", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${idToken}`,
//       },
//       body: JSON.stringify({ planId, sectionKey }),
//     });

//     const json = await res.json().catch(() => ({}));
//     if (!res.ok || !json?.ok) {
//       throw new Error(json?.error || "Failed to generate AI prompts");
//     }

//     return {
//       questions: Array.isArray(json.questions) ? (json.questions as Question[]) : [],
//       templateHash: typeof json.templateHash === "string" ? json.templateHash : undefined,
//       questionsGeneratedAt:
//         typeof json.questionsGeneratedAt === "string" ? json.questionsGeneratedAt : undefined,
//     };
//   }

//   async function generateSectionWithAI(
//     sectionKey: string,
//     answers: Record<string, string>,
//     questions?: Question[]
//   ) {
//     if (!planId || !user) throw new Error("Missing planId or user");

//     const idToken = await user.getIdToken();
//     const res = await fetch("/api/ai/handbook/section/generate", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${idToken}`,
//       },
//       body: JSON.stringify({
//         planId,
//         sectionKey,
//         answers,
//         questions: Array.isArray(questions) ? questions : undefined,
//       }),
//     });

//     const json = await res.json().catch(() => ({}));
//     if (!res.ok || !json?.ok) {
//       throw new Error(json?.error || "AI draft failed");
//     }

//     return {
//       draftContent: String(json.draftContent ?? ""),
//       templateHash: typeof json.templateHash === "string" ? json.templateHash : undefined,
//       generatedAt: typeof json.generatedAt === "string" ? json.generatedAt : undefined,
//     };
//   }

//   function updateSectionAnswer(sectionKey: string, qid: string, value: string) {
//     setTypingMap((prev) => {
//       if (!prev[sectionKey]) return prev;
//       const next = { ...prev };
//       delete next[sectionKey];
//       return next;
//     });

//     setSectionsState((prev) => {
//       const cur =
//         prev[sectionKey] ??
//         ({
//           base: BASE_TEMPLATES[sectionKey] ?? "",
//           content: "",
//           answers: {},
//           completed: false,
//           revealed: false,
//           dirty: false,
//           started: false,
//           typed: false,
//         } as HandbookSectionState);

//       return {
//         ...prev,
//         [sectionKey]: {
//           ...cur,
//           started: false,
//           typed: false,
//           answers: { ...(cur.answers ?? {}), [qid]: value },
//         },
//       };
//     });
//   }

//   function setActiveContent(value: string) {
//     setTypingMap((prev) => {
//       if (!prev[activeKey]) return prev;
//       const next = { ...prev };
//       delete next[activeKey];
//       return next;
//     });

//     setSectionsState((prev) => ({
//       ...prev,
//       [activeKey]: {
//         ...(prev[activeKey] ?? {
//           base: BASE_TEMPLATES[activeKey] ?? "",
//           answers: {},
//           completed: false,
//           revealed: false,
//           dirty: false,
//           started: false,
//           typed: false,
//         }),
//         content: value,
//         dirty: true,
//         typed: true,
//       },
//     }));
//   }

//   function goNextKey(currentKey: string) {
//     if (currentKey === PROFILE_SECTION.key) return SECTIONS[0]?.key ?? PROFILE_SECTION.key;
//     const idx = SECTIONS.findIndex((s) => s.key === currentKey);
//     const next = SECTIONS[Math.min(idx + 1, SECTIONS.length - 1)];
//     return next?.key ?? currentKey;
//   }

//   function goPrevKey(currentKey: string) {
//     if (currentKey === PROFILE_SECTION.key) return PROFILE_SECTION.key;
//     const idx = SECTIONS.findIndex((s) => s.key === currentKey);
//     if (idx <= 0) return PROFILE_SECTION.key;
//     return SECTIONS[idx - 1].key;
//   }

//   async function goNextSectionAndSave() {
//     const nextKey = goNextKey(activeKey);
//     await saveHandbookProgress(activeKey, sectionsState);
//     setActiveKey(nextKey);
//     await saveHandbookProgress(nextKey, sectionsState);
//   }

//   async function goPrevSectionAndSave() {
//     const prevKey = goPrevKey(activeKey);
//     await saveHandbookProgress(activeKey, sectionsState);
//     setActiveKey(prevKey);
//     await saveHandbookProgress(prevKey, sectionsState);
//   }

//   const activeState = activeKey === PROFILE_SECTION.key ? null : sectionsState[activeKey];
//   const activeQuestions: Question[] =
//     activeKey === PROFILE_SECTION.key ? [] : sectionsState[activeKey]?.aiQuestions ?? [];
//   const hasQuestions = activeKey !== PROFILE_SECTION.key && activeQuestions.length > 0;
//   const promptsComplete =
//     activeKey === PROFILE_SECTION.key ? true : questionsCompleteWith(activeQuestions, activeState?.answers);
//   const started = activeKey === PROFILE_SECTION.key ? false : Boolean(activeState?.started);

//   const typing = typingMap[activeKey];
//   const isTyping = Boolean(typing && !typing.done);

//   useEffect(() => {
//     if (typingIntervalRef.current) {
//       clearInterval(typingIntervalRef.current);
//       typingIntervalRef.current = null;
//     }

//     if (activeKey === PROFILE_SECTION.key) return;
//     if (!profileCompleted) return;

//     const st = sectionsState[activeKey];
//     if (!st) return;

//     if (!Array.isArray(st.aiQuestions) || st.aiQuestions.length === 0) return;

//     const ready = questionsCompleteWith(st.aiQuestions, st.answers);
//     if (!ready) return;
//     if (!st.started) return;
//     if (st.dirty) return;

//     if (st.typed) {
//       setTypingMap((prev) => {
//         if (!prev[activeKey]) return prev;
//         const n = { ...prev };
//         delete n[activeKey];
//         return n;
//       });
//       return;
//     }

//     if (!st.content || st.content.trim().length === 0) return;

//     if (!st.revealed) {
//       setSectionsState((prev) => ({
//         ...prev,
//         [activeKey]: { ...(prev[activeKey] as HandbookSectionState), revealed: true },
//       }));
//     }

//     const existingTyping = typingMap[activeKey];
//     if (existingTyping?.done) return;

//     if (!existingTyping) {
//       const tokens = wordTokens(st.content);
//       setTypingMap((prev) => ({
//         ...prev,
//         [activeKey]: { tokens, idx: 0, display: "", done: tokens.length === 0 },
//       }));
//     }

//     const start = () => {
//       typingIntervalRef.current = setInterval(() => {
//         setTypingMap((prev) => {
//           const cur = prev[activeKey];
//           if (!cur || cur.done) return prev;

//           const nextIdx = cur.idx + 1;
//           const nextDisplay = cur.display + (cur.tokens[cur.idx] ?? "");
//           const done = nextIdx >= cur.tokens.length;

//           return {
//             ...prev,
//             [activeKey]: { ...cur, idx: nextIdx, display: nextDisplay, done },
//           };
//         });
//       }, 35);
//     };

//     const t = setTimeout(start, 0);

//     return () => {
//       clearTimeout(t);
//       if (typingIntervalRef.current) {
//         clearInterval(typingIntervalRef.current);
//         typingIntervalRef.current = null;
//       }
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [activeKey, profileCompleted, sectionsState, typingMap]);

//   const orgDisplayName = (orgName || "").trim() || "Your organization";
//   const avatarText = initialsFromName(orgDisplayName);

//   async function downloadHandbook(format: "pdf" | "docx") {
//     if (!planId || !user) return;
//     setExporting(format);

//     try {
//       const idToken = await user.getIdToken();
//       const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/handbook/export/${format}`, {
//         method: "POST",
//         headers: { Authorization: `Bearer ${idToken}` },
//       });

//       if (!res.ok) {
//         const json = await res.json().catch(() => ({}));
//         throw new Error(json?.error || "Export failed");
//       }

//       const blob = await res.blob();
//       const url = window.URL.createObjectURL(blob);

//       const disposition = res.headers.get("content-disposition") || "";
//       const match = disposition.match(/filename="([^"]+)"/i);
//       const filename = match?.[1] || `handbook.${format}`;

//       const a = document.createElement("a");
//       a.href = url;
//       a.download = filename;
//       document.body.appendChild(a);
//       a.click();
//       a.remove();
//       window.URL.revokeObjectURL(url);
//     } catch (e: any) {
//       alert(e?.message || "Export failed");
//     } finally {
//       setExporting(null);
//     }
//   }

//   async function approveHandbook() {
//     if (!planId || !user) return;
//     setApproving(true);

//     try {
//       const idToken = await user.getIdToken();
//       const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/approve`, {
//         method: "POST",
//         headers: { Authorization: `Bearer ${idToken}` },
//       });

//       const json = await res.json().catch(() => ({}));
//       if (!res.ok || !json?.ok) throw new Error(json?.error || "Approve failed");

//       setPlan((p) =>
//         p
//           ? {
//               ...p,
//               status: "approved",
//               data: {
//                 ...(p.data ?? {}),
//                 handbook: {
//                   ...(p.data?.handbook ?? {}),
//                   approvedAt: new Date().toISOString(),
//                   approvedBy: { email: user.email ?? null },
//                 },
//               },
//             }
//           : p
//       );

//       alert("Handbook approved.");
//     } catch (e: any) {
//       alert(e?.message || "Approve failed");
//     } finally {
//       setApproving(false);
//     }
//   }

//   useEffect(() => {
//     if (activeKey === PROFILE_SECTION.key) return;
//     const t = typingMap[activeKey];
//     if (!t || !t.done) return;

//     const st = sectionsState[activeKey];
//     if (!st) return;
//     if (st.dirty) return;
//     if (st.typed) return;

//     setSectionsState((prev) => ({
//       ...prev,
//       [activeKey]: { ...(prev[activeKey] as HandbookSectionState), typed: true },
//     }));
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [activeKey, typingMap, sectionsState]);

//   // Close profile popover on outside click / ESC
//   useEffect(() => {
//     if (!profileOpen) return;

//     function onKeyDown(e: KeyboardEvent) {
//       if (e.key === "Escape") setProfileOpen(false);
//     }

//     function onMouseDown(e: MouseEvent) {
//       const btn = profileBtnRef.current;
//       const pop = profilePopoverRef.current;
//       const target = e.target as Node | null;
//       if (!target) return;
//       if (btn && btn.contains(target)) return;
//       if (pop && pop.contains(target)) return;
//       setProfileOpen(false);
//     }

//     window.addEventListener("keydown", onKeyDown);
//     window.addEventListener("mousedown", onMouseDown);
//     return () => {
//       window.removeEventListener("keydown", onKeyDown);
//       window.removeEventListener("mousedown", onMouseDown);
//     };
//   }, [profileOpen]);

//   if (!planId) {
//     return (
//       <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
//         <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
//           <h1 className="text-xl font-semibold text-slate-900">Fund Development Handbook Template</h1>
//           <p className="mt-2 text-slate-600">
//             Missing <span className="font-medium">planId</span>. Please return to Products and start again.
//           </p>
//           <button
//             className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
//             onClick={() => router.push("/products")}
//           >
//             Back to Products
//           </button>
//         </div>
//       </main>
//     );
//   }

//   const canAccessSections = profileCompleted;

//   const draftValue =
//     activeKey === PROFILE_SECTION.key
//       ? ""
//       : activeState?.typed
//       ? activeState?.content ?? ""
//       : typingMap[activeKey]?.display ?? activeState?.content ?? "";

//   const showQuestionsPanel =
//     activeKey !== PROFILE_SECTION.key &&
//     Array.isArray(sectionsState[activeKey]?.aiQuestions) &&
//     (sectionsState[activeKey]?.aiQuestions?.length ?? 0) > 0 &&
//     !started;

//   const showDraft = activeKey !== PROFILE_SECTION.key && started && promptsComplete;

//   return (
//     <main className="min-h-screen bg-slate-50 p-6">
//       <div className="mx-auto max-w-6xl">
//         <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
//           <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
//             <div>
//               <h1 className="text-2xl font-semibold text-slate-900">Fund Development Handbook Builder</h1>
//               <p className="mt-2 text-slate-600">
//                 AI-only flow: ask questions → answer → generate section → word-by-word typing → review/edit → save/complete.
//               </p>
//             </div>

//             {/* Right side: Progress + Profile Icon */}
//             <div className="flex items-start justify-between gap-3 md:justify-end">
//               <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
//                 <div className="text-xs font-medium text-slate-600">Progress</div>
//                 <div className="mt-1 text-sm text-slate-800">
//                   <span className="font-medium">{completionCount}</span> / {totalSections} sections complete
//                 </div>
//                 <div className="mt-2 h-2 w-64 rounded-full bg-slate-200">
//                   <div
//                     className="h-2 rounded-full bg-success-400"
//                     style={{
//                       width: `${Math.round((completionCount / Math.max(totalSections, 1)) * 100)}%`,
//                     }}
//                   />
//                 </div>
//               </div>

//               {/* Profile icon + popover */}
//               <div className="relative">
//                 <button
//                   ref={profileBtnRef}
//                   type="button"
//                   aria-label="Open profile"
//                   className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white shadow-sm hover:bg-primary-700"
//                   onClick={() => setProfileOpen((v) => !v)}
//                 >
//                   {avatarText}
//                 </button>

//                 {profileOpen ? (
//                   <div
//                     ref={profilePopoverRef}
//                     className="absolute right-0 z-50 mt-2 w-[340px] rounded-2xl border border-slate-200 bg-white p-4 shadow-lg"
//                   >
//                     <div className="flex items-start justify-between gap-3">
//                       <div className="min-w-0">
//                         <div className="text-sm font-semibold text-slate-900 truncate">{orgDisplayName}</div>
//                         <div className="mt-0.5 text-xs text-slate-600">
//                           Signed in as <span className="font-medium">{user?.email ?? "Unknown"}</span>
//                         </div>
//                       </div>
//                       <button
//                         type="button"
//                         className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
//                         onClick={() => setProfileOpen(false)}
//                       >
//                         Close
//                       </button>
//                     </div>

//                     <div className="mt-4 flex flex-col gap-2">
//                       <button
//                         type="button"
//                         className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
//                         onClick={() => {
//                           setProfileOpen(false);
//                           router.push("/dashboard");
//                         }}
//                       >
//                         Return home
//                       </button>
//                       <button
//                         type="button"
//                         className="w-full rounded-md bg-slate-900 px-3 py-2 text-left text-sm text-white hover:bg-slate-800"
//                         onClick={async () => {
//                           await signOut(auth);
//                           router.push("/login");
//                         }}
//                       >
//                         Sign out
//                       </button>
//                     </div>
//                   </div>
//                 ) : null}
//               </div>
//             </div>
//           </div>

//           <div className="mt-6 grid gap-4 md:grid-cols-3">
//             {/* Left nav */}
//             <div className="md:col-span-1">
//               <div className="rounded-2xl border border-slate-200 bg-white p-4">
//                 <div className="text-sm font-medium text-slate-900">Contents</div>
//                 <div className="mt-3 space-y-2">
//                   {ALL_NAV.map((s) => {
//                     const active = s.key === activeKey;
//                     const isProfile = s.key === PROFILE_SECTION.key;
//                     const done = isProfile ? profileCompleted : Boolean(sectionsState[s.key]?.completed);
//                     const locked = !isProfile && !canAccessSections;

//                     return (
//                       <button
//                         key={s.key}
//                         type="button"
//                         className={classNames(
//                           "w-full rounded-xl border px-3 py-2 text-left",
//                           locked ? "opacity-50 cursor-not-allowed" : "",
//                           active ? "border-slate-900 bg-white" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
//                         )}
//                         onClick={() => {
//                           if (locked) return;
//                           setActiveKey(s.key);
//                         }}
//                         disabled={locked}
//                       >
//                         <div className="flex items-center justify-between gap-3">
//                           <div className="min-w-0">
//                             <div className="truncate text-sm font-medium text-slate-900">{s.title}</div>
//                             {locked ? (
//                               <div className="mt-0.5 text-xs text-slate-600">Complete section 0 to unlock</div>
//                             ) : null}
//                           </div>
//                           <div
//                             className={classNames(
//                               "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
//                               done ? "bg-success-400 text-white" : "bg-slate-200 text-slate-700"
//                             )}
//                             title={done ? "Complete" : "Not complete"}
//                           >
//                             {done ? "✓" : ""}
//                           </div>
//                         </div>
//                       </button>
//                     );
//                   })}
//                 </div>

//                 <div className="mt-4 flex flex-wrap gap-2">
//                   <button
//                     className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                     onClick={() => router.push(`/plans/${encodeURIComponent(planId)}`)}
//                   >
//                     Back to plan
//                   </button>

//                   <button
//                     className={classNames(
//                       "rounded-md px-3 py-2 text-sm text-white",
//                       saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                     )}
//                     disabled={saving}
//                     onClick={() => saveHandbookProgress(activeKey, sectionsState)}
//                   >
//                     {saving ? "Saving..." : "Save"}
//                   </button>

//                   {saveMsg ? (
//                     <span className="px-2 py-2 text-sm font-medium text-success-500">{saveMsg}</span>
//                   ) : null}
//                 </div>
//               </div>
//             </div>

//             {/* Main content */}
//             <div className="md:col-span-2">
//               <div className="rounded-2xl border border-slate-200 bg-white p-6">
//                 {fetching ? (
//                   <div className="text-sm text-slate-600">Loading...</div>
//                 ) : (
//                   <>
//                     {/* SECTION 0 (Kickoff / Explanation) */}
//                     {activeKey === PROFILE_SECTION.key ? (
//                       <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
//                         <div className="text-xs font-semibold text-slate-600">Section 0</div>

//                         <h2 className="mt-2 text-2xl font-semibold text-slate-900">
//                           {(orgName || "Your organization").trim()} Fund Development Handbook
//                         </h2>

//                         <p className="mt-3 text-sm text-slate-700">
//                           You'll build your handbook one section at a time. For each section, the AI will:
//                         </p>

//                         <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
//                           <li>Generate a small set of questions (up to 10) based on what it still needs.</li>
//                           <li>You answer the questions.</li>
//                           <li>AI drafts the section in your template format, then you review and edit.</li>
//                         </ol>

//                         <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
//                           <div className="text-sm font-semibold text-slate-900">Website permission</div>
//                           <p className="mt-1 text-sm text-slate-700">
//                             If you provided your website and granted permission during onboarding, the AI may use publicly
//                             available information from your site to reduce the number of questions it asks.
//                           </p>
//                         </div>

//                         <div className="mt-6 flex flex-wrap items-center gap-2">
//                           <button
//                             type="button"
//                             className={classNames(
//                               "rounded-md px-4 py-2 text-sm text-white",
//                               saving ? "bg-slate-400 cursor-not-allowed" : "bg-success-400 hover:bg-success-500"
//                             )}
//                             disabled={saving}
//                             onClick={async () => {
//                               const nextKey = SECTIONS[0]?.key ?? PROFILE_SECTION.key;
//                               setProfileCompleted(true);
//                               setActiveKey(nextKey);
//                               await saveHandbookProgress(nextKey, sectionsState, true);
//                             }}
//                           >
//                             {saving ? "Saving..." : "Complete section"}
//                           </button>

//                           <span className="text-xs text-slate-600">This unlocks the rest of the handbook sections.</span>
//                         </div>
//                       </div>
//                     ) : (
//                       <>
//                         {/* Section header */}
//                         <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
//                           <div>
//                             <h2 className="text-xl font-semibold text-slate-900">{activeSection.title}</h2>
//                             <p className="mt-1 text-sm text-slate-600">
//                               Step 1: Ask questions with AI. Step 2: Answer. Step 3: Generate section.
//                             </p>
//                           </div>
//                           <div className="flex items-center gap-2">
//                             <button
//                               className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                               onClick={goPrevSectionAndSave}
//                             >
//                               Back
//                             </button>
//                             <button
//                               className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                               onClick={goNextSectionAndSave}
//                             >
//                               Next
//                             </button>
//                           </div>
//                         </div>

//                         {/* AI-only CTA (no hardcoded prompts) */}
//                         {!hasQuestions && !started ? (
//                           <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5">
//                             <div className="text-sm font-semibold text-slate-900">No questions yet</div>
//                             <p className="mt-1 text-sm text-slate-700">
//                               Click below to have AI generate the questions needed for this section.
//                             </p>
//                             <div className="mt-4 flex flex-wrap items-center gap-2">
//                               <button
//                                 type="button"
//                                 className={classNames(
//                                   "rounded-md px-3 py-2 text-sm text-white",
//                                   saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                                 )}
//                                 disabled={saving}
//                                 onClick={async () => {
//                                   try {
//                                     const { questions, templateHash, questionsGeneratedAt } = await fetchAIQuestions(
//                                       activeKey
//                                     );

//                                     const cur =
//                                       sectionsState[activeKey] ??
//                                       ({
//                                         base: BASE_TEMPLATES[activeKey] ?? "",
//                                         content: "",
//                                         answers: {},
//                                         completed: false,
//                                         revealed: false,
//                                         dirty: false,
//                                         started: false,
//                                         typed: false,
//                                       } as HandbookSectionState);

//                                     const next = {
//                                       ...sectionsState,
//                                       [activeKey]: {
//                                         ...cur,
//                                         aiQuestions: questions,
//                                         templateHash,
//                                         questionsGeneratedAt,
//                                         started: false,
//                                         typed: false,
//                                       },
//                                     };

//                                     setSectionsState(next);
//                                     await saveHandbookProgress(activeKey, next);
//                                   } catch (e: any) {
//                                     alert(e?.message || "Failed to generate AI questions");
//                                   }
//                                 }}
//                               >
//                                 Ask questions with AI
//                               </button>
//                               <div className="text-xs text-slate-600">AI will generate up to 10 questions (only what it needs).</div>
//                             </div>
//                           </div>
//                         ) : null}

//                         {/* Prompts panel (AI-only) */}
//                         {showQuestionsPanel ? (
//                           <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
//                             <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
//                               <div>
//                                 <div className="text-sm font-semibold text-slate-900">AI questions</div>
//                                 <div className="mt-1 text-xs text-slate-600">
//                                   Answer all required questions, then click Generate section.
//                                 </div>
//                               </div>
//                               <div className="flex flex-wrap items-center gap-2">
//                                 <button
//                                   type="button"
//                                   className={classNames(
//                                     "rounded-md px-3 py-2 text-sm text-white",
//                                     saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                                   )}
//                                   disabled={saving}
//                                   onClick={async () => {
//                                     try {
//                                       const { questions, templateHash, questionsGeneratedAt } = await fetchAIQuestions(
//                                         activeKey
//                                       );
//                                       const cur = sectionsState[activeKey];
//                                       if (!cur) return;

//                                       const next = {
//                                         ...sectionsState,
//                                         [activeKey]: {
//                                           ...cur,
//                                           aiQuestions: questions,
//                                           templateHash,
//                                           questionsGeneratedAt,
//                                           started: false,
//                                           typed: false,
//                                         },
//                                       };

//                                       setSectionsState(next);
//                                       await saveHandbookProgress(activeKey, next);
//                                     } catch (e: any) {
//                                       alert(e?.message || "Failed to regenerate questions");
//                                     }
//                                   }}
//                                 >
//                                   Regenerate questions
//                                 </button>

//                                 <button
//                                   type="button"
//                                   className={classNames(
//                                     "rounded-md px-3 py-2 text-sm text-white",
//                                     saving || !promptsComplete
//                                       ? "bg-slate-300 cursor-not-allowed"
//                                       : "bg-success-400 hover:bg-success-500"
//                                   )}
//                                   disabled={saving || !promptsComplete}
//                                   onClick={async () => {
//                                     const st = sectionsState[activeKey];
//                                     if (!st) return;

//                                     try {
//                                       setTypingMap((prev) => {
//                                         const n = { ...prev };
//                                         delete n[activeKey];
//                                         return n;
//                                       });

//                                       const { draftContent, templateHash, generatedAt } = await generateSectionWithAI(
//                                         activeKey,
//                                         st.answers,
//                                         st.aiQuestions
//                                       );

//                                       const next = {
//                                         ...sectionsState,
//                                         [activeKey]: {
//                                           ...st,
//                                           content: draftContent,
//                                           revealed: true,
//                                           started: true,
//                                           typed: false,
//                                           dirty: false,
//                                           templateHash: templateHash ?? st.templateHash,
//                                           generatedAt,
//                                         },
//                                       };

//                                       setSectionsState(next);
//                                       await saveHandbookProgress(activeKey, next);
//                                     } catch (e: any) {
//                                       alert(e?.message || "Failed to generate section");
//                                     }
//                                   }}
//                                 >
//                                   Generate section
//                                 </button>
//                               </div>
//                             </div>

//                             <div className="mt-4 grid gap-4 sm:grid-cols-2">
//                               {activeQuestions.map((q) => {
//                                 const isMultiSelect = q.type === "multiselect";
//                                 const hasOtherOption = Array.isArray(q.options) && q.options.includes("Other");
//                                 const val = activeState?.answers?.[q.id] ?? "";
//                                 let multiVals: string[] = [];
//                                 if (isMultiSelect) {
//                                   multiVals = parseMulti(String(val || "[]"));
//                                 }
//                                 const isSelect = q.type === "select";
//                                 const otherKey = `${q.id}__other`;
//                                 const otherVal = activeState?.answers?.[otherKey] ?? "";
//                                 const showOtherBox =
//                                   (isSelect && hasOtherOption && val === "Other") ||
//                                   (isMultiSelect && hasOtherOption && multiVals.includes("Other"));
//                                 const isTextarea = q.type === "textarea";

//                                 return (
//                                   <div key={q.id} className={isTextarea ? "sm:col-span-2" : ""}>
//                                     <label className="text-sm font-medium text-slate-900">
//                                       {q.label}
//                                       {q.required ? <span className="text-rose-600"> *</span> : null}
//                                     </label>
//                                     {q.helper ? <div className="mt-1 text-xs text-slate-600">{q.helper}</div> : null}

//                                     {isSelect ? (
//                                       <select
//                                         className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                         value={val}
//                                         onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
//                                       >
//                                         <option value="">{q.placeholder ?? "Select one"}</option>
//                                         {(q.options ?? []).map((opt) => (
//                                           <option key={opt} value={opt}>
//                                             {opt}
//                                           </option>
//                                         ))}
//                                       </select>
//                                     ) : isMultiSelect ? (
//                                       <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
//                                         {(q.options ?? []).map((opt) => {
//                                           const checked = multiVals.includes(opt);
//                                           return (
//                                             <label key={opt} className="flex items-center gap-2 text-sm text-slate-900">
//                                               <input
//                                                 type="checkbox"
//                                                 checked={checked}
//                                                 onChange={(e) => {
//                                                   const next = e.target.checked
//                                                     ? Array.from(new Set([...multiVals, opt]))
//                                                     : multiVals.filter((x) => x !== opt);
//                                                   updateSectionAnswer(activeKey, q.id, JSON.stringify(next));
//                                                 }}
//                                               />
//                                               <span>{opt}</span>
//                                             </label>
//                                           );
//                                         })}
//                                       </div>
//                                     ) : isTextarea ? (
//                                       <textarea
//                                         className="mt-2 min-h-[110px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                         placeholder={q.placeholder}
//                                         value={val}
//                                         onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
//                                       />
//                                     ) : (
//                                       <input
//                                         className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                         placeholder={q.placeholder}
//                                         value={val}
//                                         onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
//                                       />
//                                     )}

//                                     {showOtherBox ? (
//                                       <textarea
//                                         className="mt-2 min-h-[90px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                         placeholder="Please specify..."
//                                         value={otherVal}
//                                         onChange={(e) => updateSectionAnswer(activeKey, otherKey, e.target.value)}
//                                       />
//                                     ) : null}
//                                   </div>
//                                 );
//                               })}
//                             </div>
//                           </div>
//                         ) : null}

//                         {/* Draft area */}
//                         <div className="mt-5">
//                           <label className="text-sm font-medium text-slate-900">Section text</label>

//                           {!showDraft ? (
//                             <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
//                               <div className="text-sm font-semibold text-slate-900">Hidden until you generate</div>
//                               <p className="mt-1 text-sm text-slate-700">
//                                 Ask questions, answer them, then click <span className="font-medium">Generate section</span>.
//                               </p>
//                             </div>
//                           ) : (
//                             <div className="relative">
//                               <textarea
//                                 className="mt-2 min-h-[320px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                 value={draftValue}
//                                 onChange={(e) => setActiveContent(e.target.value)}
//                                 disabled={isTyping}
//                               />
//                               {isTyping ? (
//                                 <div className="absolute right-3 top-3 rounded-full bg-slate-900 px-3 py-1 text-xs text-white">
//                                   Writing…
//                                 </div>
//                               ) : null}
//                             </div>
//                           )}

//                           <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
//                             <div className="text-xs text-slate-600">
//                               {isTyping ? "Please wait while the section finishes writing." : "You can edit once writing finishes."}
//                             </div>

//                             <div className="flex items-center gap-2">
//                               <button
//                                 className={classNames(
//                                   "rounded-md px-3 py-2 text-sm text-white",
//                                   saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                                 )}
//                                 disabled={saving}
//                                 onClick={() => saveHandbookProgress(activeKey, sectionsState)}
//                               >
//                                 {saving ? "Saving..." : "Save"}
//                               </button>

//                               <button
//                                 className={classNames(
//                                   "rounded-md px-3 py-2 text-sm text-white",
//                                   showDraft && !isTyping && (activeState?.content ?? "").trim().length >= 50
//                                     ? "bg-success-400 hover:bg-success-500"
//                                     : "bg-slate-300 cursor-not-allowed"
//                                 )}
//                                 disabled={!showDraft || isTyping || (activeState?.content ?? "").trim().length < 50}
//                                 onClick={async () => {
//                                   const cur = sectionsState[activeKey];
//                                   if (!cur) return;

//                                   const next = {
//                                     ...sectionsState,
//                                     [activeKey]: { ...cur, completed: true, typed: true },
//                                   };

//                                   setSectionsState(next);

//                                   const nextKey = goNextKey(activeKey);
//                                   setActiveKey(nextKey);
//                                   await saveHandbookProgress(nextKey, next);
//                                 }}
//                               >
//                                 Complete section
//                               </button>

//                               <button
//                                 className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                                 onClick={async () => {
//                                   const cur = sectionsState[activeKey];
//                                   if (!cur) return;

//                                   const next = { ...sectionsState, [activeKey]: { ...cur, completed: false } };
//                                   setSectionsState(next);
//                                   await saveHandbookProgress(activeKey, next);
//                                 }}
//                               >
//                                 Mark incomplete
//                               </button>
//                             </div>
//                           </div>
//                         </div>
//                       </>
//                     )}
//                   </>
//                 )}
//               </div>
//             </div>
//           </div>

//           {/* Sticky export bar (always available) */}
//           <div className="sticky bottom-0 mt-6">
//             <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
//               <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
//                 <div className="min-w-0">
//                   <div className="text-sm font-semibold text-slate-900">Download your handbook</div>
//                   <div className="mt-1 text-xs text-slate-600">
//                     Exports the latest saved content (including incomplete sections).
//                   </div>
//                 </div>

//                 <div className="flex flex-wrap items-center gap-2">
//                   <button
//                     type="button"
//                     className={classNames(
//                       "rounded-md px-3 py-2 text-sm text-white",
//                       exporting ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                     )}
//                     disabled={Boolean(exporting)}
//                     onClick={() => downloadHandbook("pdf")}
//                   >
//                     {exporting === "pdf" ? "Generating PDF..." : "Download PDF"}
//                   </button>

//                   <button
//                     type="button"
//                     className={classNames(
//                       "rounded-md px-3 py-2 text-sm text-white",
//                       exporting ? "bg-slate-400 cursor-not-allowed" : "bg-success-400 hover:bg-success-500"
//                     )}
//                     disabled={Boolean(exporting)}
//                     onClick={() => downloadHandbook("docx")}
//                   >
//                     {exporting === "docx" ? "Generating Word..." : "Download Word (.docx)"}
//                   </button>
//                 </div>

//                 <button
//                   type="button"
//                   className={classNames(
//                     "rounded-md px-3 py-2 text-sm text-white",
//                     approving ? "bg-slate-400 cursor-not-allowed" : "bg-success-400 hover:bg-success-500"
//                   )}
//                   disabled={approving}
//                   onClick={approveHandbook}
//                 >
//                   {approving ? "Approving..." : "Approve Fund Development Handbook"}
//                 </button>
//               </div>
//             </div>
//           </div>

//           <p className="mt-6 text-xs text-slate-500">
//             AI-only section flow: Ask questions → Answer → Generate section → Review/edit → Save/complete. Word-by-word animation runs only the first time unless answers change.
//           </p>
//         </div>
//       </div>
//     </main>
//   );
// }




// "use client";

// import { useEffect, useMemo, useRef, useState } from "react";
// import { useRouter, useSearchParams } from "next/navigation";
// import { useAuth } from "@/lib/AuthContext";
// import { BASE_TEMPLATES } from "@/lib/handbookTemplates";

// type Section = {
//   key: string;
//   title: string;
//   order: number;
// };

// type Plan = {
//   id: string;
//   title?: string;
//   templateType?: string;
//   data?: any;
//   status?: string;
// };

// type Question = {
//   id: string;
//   label: string;
//   helper?: string;
//   placeholder?: string;
//   type?: "text" | "textarea" | "select" | "multiselect";
//   options?: string[];
//   required?: boolean;
// };

// type HandbookSectionState = {
//   base: string;
//   content: string; // saved final content (full)
//   answers: Record<string, string>;
//   completed: boolean;
//   revealed: boolean;
//   dirty: boolean; // user manually edited content
//   started: boolean; // user clicked Generate section; prompts hide; typing begins
//   typed: boolean; // true once the word-by-word animation finished at least once
//   aiQuestions?: Question[]; // ✅ AI-generated prompts (optional)

//   // optional metadata returned by server
//   templateHash?: string;
//   questionsGeneratedAt?: string;
//   generatedAt?: string;
// };

// const PROFILE_SECTION: Section = {
//   key: "s0_profile",
//   title: "0. Base informational questions",
//   order: 0,
// };

// const SECTIONS: Section[] = [
//   { key: "s1_intro", title: "1. Introduction and Purpose", order: 1 },
//   { key: "s2_philosophy", title: "2. Fund Development Philosophy and Definitions", order: 2 },
//   { key: "s3_roles", title: "3. Roles and Responsibilities", order: 3 },
//   { key: "s4_ethics", title: "4. Ethical Fundraising Framework", order: 4 },
//   { key: "s5_gift_acceptance", title: "5. Gift Acceptance Policy", order: 5 },
//   { key: "s5a_major_gifts", title: "5A. Major Gifts Acceptance Policy", order: 6 },
//   { key: "s6_processing", title: "6. Gift Processing Policies and Procedures", order: 7 },
//   { key: "s7_recognition", title: "7. Donor Recognition and Acknowledgement", order: 8 },
//   { key: "s8_stewardship", title: "8. Donor Cultivation and Stewardship", order: 9 },
//   { key: "s9_grants", title: "9. Grants Management", order: 10 },
//   { key: "s10_awards_declines", title: "10. Funding Announcements and Declinations", order: 11 },
//   { key: "s11_sponsorships", title: "11. Corporate Sponsorships", order: 12 },
//   { key: "s12_events", title: "12. Special Events Fundraising", order: 13 },
//   { key: "s13_inkind", title: "13. In-Kind Donations", order: 14 },
//   { key: "s14_planned_giving", title: "14. Legacy and Planned Giving", order: 15 },
//   { key: "s15_financial", title: "15. Financial Management and Reporting", order: 16 },
//   { key: "s16_compliance", title: "16. Compliance, Governance, and Accountability", order: 17 },
//   { key: "s17_appendices", title: "17. Appendices and Attachments", order: 18 },
// ];

// const ALL_NAV: Section[] = [PROFILE_SECTION, ...SECTIONS];

// // ------------------------------------------------------------
// // Helpers
// // ------------------------------------------------------------
// function classNames(...xs: Array<string | false | undefined | null>) {
//   return xs.filter(Boolean).join(" ");
// }

// // Word-by-word tokens (preserves whitespace after each word)
// function wordTokens(full: string) {
//   return full.match(/\S+\s*/g) ?? [];
// }

// function questionsCompleteWith(qs: Question[], answers?: Record<string, string>) {
//   if (!qs || qs.length === 0) return true;
//   const ans = answers ?? {};
//   return qs.every((q) => {
//     const required = q.required !== false;
//     if (!required) return true;
//     const v = String(ans[q.id] ?? "").trim();
//     return v.length > 0;
//   });
// }

// // Typing state per section (not saved)
// type TypingState = {
//   tokens: string[];
//   idx: number;
//   display: string;
//   done: boolean;
// };

// export default function FundDevHandbookTemplatePage() {
//   const router = useRouter();
//   const params = useSearchParams();
//   const planId = params.get("planId");
//   const { user, loading } = useAuth();

//   const [plan, setPlan] = useState<Plan | null>(null);
//   const [fetching, setFetching] = useState(true);
//   const [saving, setSaving] = useState(false);
//   const [saveMsg, setSaveMsg] = useState<string | null>(null);

//   const [activeKey, setActiveKey] = useState<string>(PROFILE_SECTION.key);

//   // ✅ new: org name for display only (from /api/me)
//   const [orgName, setOrgName] = useState<string>("");

//   // ✅ section 0 completion still gates access
//   const [profileCompleted, setProfileCompleted] = useState<boolean>(false);

//   const [sectionsState, setSectionsState] = useState<Record<string, HandbookSectionState>>({});

//   // typing animations (per section)
//   const [typingMap, setTypingMap] = useState<Record<string, TypingState>>({});
//   const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);

//   useEffect(() => {
//     if (!loading && !user) router.push("/login");
//   }, [user, loading, router]);

//   async function fetchOrgDisplayName() {
//     if (!user) return "";
//     const idToken = await user.getIdToken();
//     const res = await fetch("/api/me", {
//       headers: { Authorization: `Bearer ${idToken}` },
//     });
//     const json = await res.json().catch(() => ({}));
//     if (!res.ok) return "";
//     return String(json?.org?.name ?? json?.orgName ?? "").trim();
//   }

//   // Load plan and hydrate sections
//   useEffect(() => {
//     if (!planId || !user) return;
//     let cancelled = false;

//     (async () => {
//       setFetching(true);
//       try {
//         const idToken = await user.getIdToken();
//         const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`, {
//           headers: { Authorization: `Bearer ${idToken}` },
//         });
//         const json = await res.json();
//         if (!res.ok) throw new Error(json?.error || "Failed to load plan");
//         if (cancelled) return;

//         const loadedPlan: Plan = json.plan;
//         setPlan(loadedPlan);

//         // ✅ Set org name for UI display
//         const nameFromMe = await fetchOrgDisplayName();
//         if (nameFromMe) setOrgName(nameFromMe);

//         // Backwards-compatible fallback (old plans that stored handbook.profile.orgName)
//         if (!nameFromMe) {
//           const hb = loadedPlan?.data?.handbook ?? {};
//           const legacy = String(hb?.profile?.orgName ?? "").trim();
//           if (legacy) setOrgName(legacy);
//         }

//         const hb = loadedPlan?.data?.handbook ?? {};
//         setProfileCompleted(Boolean(hb?.profileCompleted));

//         const existing = hb?.sections ?? {};
//         const nextState: Record<string, HandbookSectionState> = {};

//         for (const s of SECTIONS) {
//           const prev = existing?.[s.key] ?? {};
//           const base =
//             typeof prev?.base === "string" ? prev.base : BASE_TEMPLATES[s.key] ?? "";
//           const contentFromOld = typeof prev?.content === "string" ? prev.content : "";
//           const revealed =
//             typeof prev?.revealed === "boolean"
//               ? prev.revealed
//               : contentFromOld.trim().length > 0;
//           const started =
//             typeof prev?.started === "boolean" ? prev.started : revealed;
//           const typed =
//             typeof prev?.typed === "boolean"
//               ? prev.typed
//               : Boolean(prev?.completed) && contentFromOld.trim().length > 0;

//           const aiQuestions = Array.isArray(prev?.aiQuestions)
//             ? (prev.aiQuestions as Question[])
//             : undefined;

//           nextState[s.key] = {
//             base,
//             content: contentFromOld,
//             answers: typeof prev?.answers === "object" && prev?.answers ? prev.answers : {},
//             completed: Boolean(prev?.completed),
//             revealed,
//             dirty: Boolean(prev?.dirty),
//             started,
//             typed,
//             aiQuestions,
//             templateHash: typeof prev?.templateHash === "string" ? prev.templateHash : undefined,
//             questionsGeneratedAt:
//               typeof prev?.questionsGeneratedAt === "string" ? prev.questionsGeneratedAt : undefined,
//             generatedAt: typeof prev?.generatedAt === "string" ? prev.generatedAt : undefined,
//           };
//         }

//         setSectionsState(nextState);

//         const storedActive = hb?.activeKey;

//         if (!hb?.profileCompleted) {
//           setActiveKey(PROFILE_SECTION.key);
//         } else if (
//           typeof storedActive === "string" &&
//           (storedActive === PROFILE_SECTION.key || storedActive in nextState)
//         ) {
//           setActiveKey(storedActive);
//         } else {
//           setActiveKey(SECTIONS[0].key);
//         }
//       } catch (e: any) {
//         alert(e?.message || "Failed to load plan");
//       } finally {
//         if (!cancelled) setFetching(false);
//       }
//     })();

//     return () => {
//       cancelled = true;
//     };
//   }, [planId, user]);

//   const activeSection = useMemo(() => {
//     if (activeKey === PROFILE_SECTION.key) return PROFILE_SECTION;
//     return SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
//   }, [activeKey]);

//   const completionCount = useMemo(() => {
//     const vals = Object.values(sectionsState);
//     if (!vals.length) return 0;
//     return vals.filter((v) => v.completed).length;
//   }, [sectionsState]);

//   const totalSections = SECTIONS.length;

//   async function saveHandbookProgress(
//     nextActiveKey: string,
//     nextSectionsState: Record<string, HandbookSectionState>,
//     nextProfileCompleted?: boolean
//   ) {
//     if (!planId || !user) return;

//     setSaving(true);
//     setSaveMsg(null);

//     try {
//       const idToken = await user.getIdToken();

//       const handbook = {
//         ...(plan?.data?.handbook ?? {}),
//         activeKey: nextActiveKey,
//         profileCompleted:
//           typeof nextProfileCompleted === "boolean" ? nextProfileCompleted : profileCompleted,
//         sections: nextSectionsState,
//       };

//       const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/handbook`, {
//         method: "PATCH",
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${idToken}`,
//         },
//         body: JSON.stringify({ handbook }),
//       });

//       const json = await res.json().catch(() => ({}));
//       if (!res.ok) throw new Error(json?.error || "Save failed");

//       setPlan((p) => (p ? { ...p, data: { ...(p.data ?? {}), handbook } } : p));
//       setSaveMsg("Saved");
//       setTimeout(() => setSaveMsg(null), 1200);
//     } catch (e: any) {
//       alert(e?.message || "Save failed");
//     } finally {
//       setSaving(false);
//     }
//   }

//   async function fetchAIQuestions(sectionKey: string) {
//     if (!planId || !user)
//       return {
//         questions: [] as Question[],
//         templateHash: undefined as string | undefined,
//         questionsGeneratedAt: undefined as string | undefined,
//       };

//     const idToken = await user.getIdToken();
//     const res = await fetch("/api/ai/handbook/section/questions", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${idToken}`,
//       },
//       body: JSON.stringify({ planId, sectionKey }),
//     });

//     const json = await res.json().catch(() => ({}));
//     if (!res.ok || !json?.ok) {
//       throw new Error(json?.error || "Failed to generate AI prompts");
//     }

//     return {
//       questions: Array.isArray(json.questions) ? (json.questions as Question[]) : [],
//       templateHash: typeof json.templateHash === "string" ? json.templateHash : undefined,
//       questionsGeneratedAt:
//         typeof json.questionsGeneratedAt === "string" ? json.questionsGeneratedAt : undefined,
//     };
//   }

//   async function generateSectionWithAI(
//     sectionKey: string,
//     answers: Record<string, string>,
//     questions?: Question[]
//   ) {
//     if (!planId || !user) throw new Error("Missing planId or user");

//     const idToken = await user.getIdToken();
//     const res = await fetch("/api/ai/handbook/section/generate", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${idToken}`,
//       },
//       body: JSON.stringify({
//         planId,
//         sectionKey,
//         answers,
//         questions: Array.isArray(questions) ? questions : undefined,
//       }),
//     });

//     const json = await res.json().catch(() => ({}));
//     if (!res.ok || !json?.ok) {
//       throw new Error(json?.error || "AI draft failed");
//     }

//     return {
//       draftContent: String(json.draftContent ?? ""),
//       templateHash: typeof json.templateHash === "string" ? json.templateHash : undefined,
//       generatedAt: typeof json.generatedAt === "string" ? json.generatedAt : undefined,
//     };
//   }

//   // If answers change after they've started, bring prompts back and stop typing
//   function updateSectionAnswer(sectionKey: string, qid: string, value: string) {
//     // stop typing
//     setTypingMap((prev) => {
//       if (!prev[sectionKey]) return prev;
//       const next = { ...prev };
//       delete next[sectionKey];
//       return next;
//     });

//     setSectionsState((prev) => {
//       const cur =
//         prev[sectionKey] ??
//         ({
//           base: BASE_TEMPLATES[sectionKey] ?? "",
//           content: "",
//           answers: {},
//           completed: false,
//           revealed: false,
//           dirty: false,
//           started: false,
//           typed: false,
//         } as HandbookSectionState);

//       return {
//         ...prev,
//         [sectionKey]: {
//           ...cur,
//           started: false, // prompts visible until they click Generate again
//           typed: false, // allow re-run typing
//           answers: { ...(cur.answers ?? {}), [qid]: value },
//         },
//       };
//     });
//   }

//   function setActiveContent(value: string) {
//     // stop typing
//     setTypingMap((prev) => {
//       if (!prev[activeKey]) return prev;
//       const next = { ...prev };
//       delete next[activeKey];
//       return next;
//     });

//     setSectionsState((prev) => ({
//       ...prev,
//       [activeKey]: {
//         ...(prev[activeKey] ?? {
//           base: BASE_TEMPLATES[activeKey] ?? "",
//           answers: {},
//           completed: false,
//           revealed: false,
//           dirty: false,
//           started: false,
//           typed: false,
//         }),
//         content: value,
//         dirty: true,
//         typed: true, // manual edit => never re-animate on resume
//       },
//     }));
//   }

//   function goNextKey(currentKey: string) {
//     if (currentKey === PROFILE_SECTION.key) return SECTIONS[0]?.key ?? PROFILE_SECTION.key;
//     const idx = SECTIONS.findIndex((s) => s.key === currentKey);
//     const next = SECTIONS[Math.min(idx + 1, SECTIONS.length - 1)];
//     return next?.key ?? currentKey;
//   }

//   function goPrevKey(currentKey: string) {
//     if (currentKey === PROFILE_SECTION.key) return PROFILE_SECTION.key;
//     const idx = SECTIONS.findIndex((s) => s.key === currentKey);
//     if (idx <= 0) return PROFILE_SECTION.key;
//     return SECTIONS[idx - 1].key;
//   }

//   async function goNextSectionAndSave() {
//     const nextKey = goNextKey(activeKey);
//     await saveHandbookProgress(activeKey, sectionsState);
//     setActiveKey(nextKey);
//     await saveHandbookProgress(nextKey, sectionsState);
//   }

//   async function goPrevSectionAndSave() {
//     const prevKey = goPrevKey(activeKey);
//     await saveHandbookProgress(activeKey, sectionsState);
//     setActiveKey(prevKey);
//     await saveHandbookProgress(prevKey, sectionsState);
//   }

//   // -----------------------------------------
//   // Word-by-word typing (active section only)
//   // Starts ONLY when:
//   // - profileCompleted
//   // - aiQuestions exist
//   // - required answers complete
//   // - user clicked Generate section (started)
//   // - not dirty
//   // - not already typed
//   // -----------------------------------------
//   const activeState = activeKey === PROFILE_SECTION.key ? null : sectionsState[activeKey];
//   const activeQuestions: Question[] =
//     activeKey === PROFILE_SECTION.key ? [] : sectionsState[activeKey]?.aiQuestions ?? [];
//   const hasQuestions = activeKey !== PROFILE_SECTION.key && activeQuestions.length > 0;
//   const promptsComplete =
//     activeKey === PROFILE_SECTION.key ? true : questionsCompleteWith(activeQuestions, activeState?.answers);
//   const started = activeKey === PROFILE_SECTION.key ? false : Boolean(activeState?.started);

//   const typing = typingMap[activeKey];
//   const isTyping = Boolean(typing && !typing.done);

//   useEffect(() => {
//     if (typingIntervalRef.current) {
//       clearInterval(typingIntervalRef.current);
//       typingIntervalRef.current = null;
//     }

//     if (activeKey === PROFILE_SECTION.key) return;
//     if (!profileCompleted) return;

//     const st = sectionsState[activeKey];
//     if (!st) return;

//     // must have AI prompts
//     if (!Array.isArray(st.aiQuestions) || st.aiQuestions.length === 0) return;

//     // must be answered + started
//     const ready = questionsCompleteWith(st.aiQuestions, st.answers);
//     if (!ready) return;
//     if (!st.started) return;
//     if (st.dirty) return;

//     if (st.typed) {
//       setTypingMap((prev) => {
//         if (!prev[activeKey]) return prev;
//         const n = { ...prev };
//         delete n[activeKey];
//         return n;
//       });
//       return;
//     }

//     if (!st.content || st.content.trim().length === 0) return;

//     if (!st.revealed) {
//       setSectionsState((prev) => ({
//         ...prev,
//         [activeKey]: { ...(prev[activeKey] as HandbookSectionState), revealed: true },
//       }));
//     }

//     const existingTyping = typingMap[activeKey];
//     if (existingTyping?.done) return;

//     if (!existingTyping) {
//       const tokens = wordTokens(st.content);
//       setTypingMap((prev) => ({
//         ...prev,
//         [activeKey]: { tokens, idx: 0, display: "", done: tokens.length === 0 },
//       }));
//     }

//     const start = () => {
//       typingIntervalRef.current = setInterval(() => {
//         setTypingMap((prev) => {
//           const cur = prev[activeKey];
//           if (!cur || cur.done) return prev;

//           const nextIdx = cur.idx + 1;
//           const nextDisplay = cur.display + (cur.tokens[cur.idx] ?? "");
//           const done = nextIdx >= cur.tokens.length;

//           return {
//             ...prev,
//             [activeKey]: { ...cur, idx: nextIdx, display: nextDisplay, done },
//           };
//         });
//       }, 35);
//     };

//     const t = setTimeout(start, 0);

//     return () => {
//       clearTimeout(t);
//       if (typingIntervalRef.current) {
//         clearInterval(typingIntervalRef.current);
//         typingIntervalRef.current = null;
//       }
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [activeKey, profileCompleted, sectionsState, typingMap]);

//   // ------------------------------------------------------------
//   // Profile popover (top-right)
//   // ------------------------------------------------------------
//   const [profileOpen, setProfileOpen] = useState(false);
//   const profileBtnRef = useRef<HTMLButtonElement | null>(null);
//   const profilePopoverRef = useRef<HTMLDivElement | null>(null);

//   function initialsFromName(name?: string) {
//     const n = String(name ?? "").trim();
//     if (!n) return "U";
//     const parts = n.split(/\s+/).filter(Boolean);
//     const a = parts[0]?.[0] ?? "U";
//     const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
//     return (a + b).toUpperCase();
//   }

//   const orgDisplayName = (orgName || "").trim() || "Your organization";
//   const avatarText = initialsFromName(orgDisplayName);

//   // ------------------------------------------------------------
//   // Export (PDF / DOCX)
//   // ------------------------------------------------------------
//   const [exporting, setExporting] = useState<null | "pdf" | "docx">(null);

//   async function downloadHandbook(format: "pdf" | "docx") {
//     if (!planId || !user) return;
//     setExporting(format);

//     try {
//       const idToken = await user.getIdToken();
//       const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/handbook/export/${format}`, {
//         method: "POST",
//         headers: { Authorization: `Bearer ${idToken}` },
//       });

//       if (!res.ok) {
//         const json = await res.json().catch(() => ({}));
//         throw new Error(json?.error || "Export failed");
//       }

//       const blob = await res.blob();
//       const url = window.URL.createObjectURL(blob);

//       // filename from server header if present
//       const disposition = res.headers.get("content-disposition") || "";
//       const match = disposition.match(/filename="([^"]+)"/i);
//       const filename = match?.[1] || `handbook.${format}`;

//       const a = document.createElement("a");
//       a.href = url;
//       a.download = filename;
//       document.body.appendChild(a);
//       a.click();
//       a.remove();
//       window.URL.revokeObjectURL(url);
//     } catch (e: any) {
//       alert(e?.message || "Export failed");
//     } finally {
//       setExporting(null);
//     }
//   }

//   // Approve handbook (finalize)
//   const [approving, setApproving] = useState(false);

//   async function approveHandbook() {
//     if (!planId || !user) return;
//     setApproving(true);

//     try {
//       const idToken = await user.getIdToken();
//       const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/approve`, {
//         method: "POST",
//         headers: { Authorization: `Bearer ${idToken}` },
//       });

//       const json = await res.json().catch(() => ({}));
//       if (!res.ok || !json?.ok) throw new Error(json?.error || "Approve failed");

//       // Update local plan snapshot so UI can reflect approved status immediately
//       setPlan((p) =>
//         p
//           ? {
//               ...p,
//               status: "approved",
//               data: {
//                 ...(p.data ?? {}),
//                 handbook: {
//                   ...(p.data?.handbook ?? {}),
//                   approvedAt: new Date().toISOString(), // UI-only; server has real timestamp
//                   approvedBy: { email: user.email ?? null },
//                 },
//               },
//             }
//           : p
//       );

//       alert("Handbook approved.");
//     } catch (e: any) {
//       alert(e?.message || "Approve failed");
//     } finally {
//       setApproving(false);
//     }
//   }

//   // When typing finishes for the active section, mark it typed=true (saved state)
//   useEffect(() => {
//     if (activeKey === PROFILE_SECTION.key) return;
//     const t = typingMap[activeKey];
//     if (!t || !t.done) return;

//     const st = sectionsState[activeKey];
//     if (!st) return;
//     if (st.dirty) return;
//     if (st.typed) return;

//     setSectionsState((prev) => ({
//       ...prev,
//       [activeKey]: { ...(prev[activeKey] as HandbookSectionState), typed: true },
//     }));
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [activeKey, typingMap, sectionsState]);

//   // Close profile popover on outside click / ESC
//   useEffect(() => {
//     if (!profileOpen) return;

//     function onKeyDown(e: KeyboardEvent) {
//       if (e.key === "Escape") setProfileOpen(false);
//     }

//     function onMouseDown(e: MouseEvent) {
//       const btn = profileBtnRef.current;
//       const pop = profilePopoverRef.current;
//       const target = e.target as Node | null;
//       if (!target) return;
//       if (btn && btn.contains(target)) return;
//       if (pop && pop.contains(target)) return;
//       setProfileOpen(false);
//     }

//     window.addEventListener("keydown", onKeyDown);
//     window.addEventListener("mousedown", onMouseDown);
//     return () => {
//       window.removeEventListener("keydown", onKeyDown);
//       window.removeEventListener("mousedown", onMouseDown);
//     };
//   }, [profileOpen]);

//   // -----------------------------------------
//   // Guard: missing planId
//   // -----------------------------------------
//   if (!planId) {
//     return (
//       <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
//         <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
//           <h1 className="text-xl font-semibold text-slate-900">Fund Development Handbook Template</h1>
//           <p className="mt-2 text-slate-600">
//             Missing <span className="font-medium">planId</span>. Please return to Products and start again.
//           </p>
//           <button
//             className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
//             onClick={() => router.push("/products")}
//           >
//             Back to Products
//           </button>
//         </div>
//       </main>
//     );
//   }

//   const canAccessSections = profileCompleted;

//   const draftValue =
//     activeKey === PROFILE_SECTION.key
//       ? ""
//       : activeState?.typed
//       ? activeState?.content ?? ""
//       : typingMap[activeKey]?.display ?? activeState?.content ?? "";

//   // AI-only behavior:
//   // - prompts panel shows only after user clicks "Ask questions with AI"
//   // - draft shows only after user clicks "Generate section"
//   const showQuestionsPanel =
//     activeKey !== PROFILE_SECTION.key &&
//     Array.isArray(sectionsState[activeKey]?.aiQuestions) &&
//     (sectionsState[activeKey]?.aiQuestions?.length ?? 0) > 0 &&
//     !started;

//   const showDraft = activeKey !== PROFILE_SECTION.key && started && promptsComplete;

//   return (
//     <main className="min-h-screen bg-slate-50 p-6">
//       <div className="mx-auto max-w-6xl">
//         <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
//           <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
//             <div>
//               <h1 className="text-2xl font-semibold text-slate-900">Fund Development Handbook Builder</h1>
//               <p className="mt-2 text-slate-600">
//                 AI-only flow: ask questions → answer → generate section → word-by-word typing → review/edit → save/complete.
//               </p>
//             </div>

//             {/* Right side: Progress + Profile */}
//             <div className="flex items-start justify-between gap-3 md:justify-end">
//               <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
//                 <div className="text-xs font-medium text-slate-600">Progress</div>
//                 <div className="mt-1 text-sm text-slate-800">
//                   <span className="font-medium">{completionCount}</span> / {totalSections} sections complete
//                 </div>
//                 <div className="mt-2 h-2 w-64 rounded-full bg-slate-200">
//                   <div
//                     className="h-2 rounded-full bg-success-400"
//                     style={{
//                       width: `${Math.round((completionCount / Math.max(totalSections, 1)) * 100)}%`,
//                     }}
//                   />
//                 </div>
//               </div>

//               {/* Profile icon + popover */}
//               <div className="relative">
//                 <button
//                   ref={profileBtnRef}
//                   type="button"
//                   aria-label="Open profile"
//                   className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
//                   onClick={() => setProfileOpen((v) => !v)}
//                 >
//                   {avatarText}
//                 </button>

//                 {profileOpen ? (
//                   <div
//                     ref={profilePopoverRef}
//                     className="absolute right-0 z-50 mt-2 w-[340px] rounded-2xl border border-slate-200 bg-white p-4 shadow-lg"
//                   >
//                     <div className="flex items-start justify-between gap-3">
//                       <div className="min-w-0">
//                         <div className="text-sm font-semibold text-slate-900 truncate">{orgDisplayName}</div>
//                         <div className="mt-0.5 text-xs text-slate-600">
//                           Signed in as <span className="font-medium">{user?.email ?? "Unknown"}</span>
//                         </div>
//                       </div>
//                       <button
//                         type="button"
//                         className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
//                         onClick={() => setProfileOpen(false)}
//                       >
//                         Close
//                       </button>
//                     </div>

//                     <div className="mt-4 flex items-center justify-between gap-2">
//                       <button
//                         type="button"
//                         className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                         onClick={() => {
//                           setProfileOpen(false);
//                           router.push("/dashboard");
//                         }}
//                       >
//                         Return home
//                       </button>
//                       <button
//                         type="button"
//                         className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
//                         onClick={() => {
//                           setProfileOpen(false);
//                           router.push(`/plans/${encodeURIComponent(planId)}`);
//                         }}
//                       >
//                         Back to plan
//                       </button>
//                     </div>
//                   </div>
//                 ) : null}
//               </div>
//             </div>
//           </div>

//           <div className="mt-6 grid gap-4 md:grid-cols-3">
//             {/* Left nav */}
//             <div className="md:col-span-1">
//               <div className="rounded-2xl border border-slate-200 bg-white p-4">
//                 <div className="text-sm font-medium text-slate-900">Contents</div>
//                 <div className="mt-3 space-y-2">
//                   {ALL_NAV.map((s) => {
//                     const active = s.key === activeKey;
//                     const isProfile = s.key === PROFILE_SECTION.key;
//                     const done = isProfile ? profileCompleted : Boolean(sectionsState[s.key]?.completed);
//                     const locked = !isProfile && !canAccessSections;

//                     return (
//                       <button
//                         key={s.key}
//                         type="button"
//                         className={classNames(
//                           "w-full rounded-xl border px-3 py-2 text-left",
//                           locked ? "opacity-50 cursor-not-allowed" : "",
//                           active ? "border-slate-900 bg-white" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
//                         )}
//                         onClick={() => {
//                           if (locked) return;
//                           setActiveKey(s.key);
//                         }}
//                         disabled={locked}
//                       >
//                         <div className="flex items-center justify-between gap-3">
//                           <div className="min-w-0">
//                             <div className="truncate text-sm font-medium text-slate-900">{s.title}</div>
//                             {locked ? (
//                               <div className="mt-0.5 text-xs text-slate-600">Complete section 0 to unlock</div>
//                             ) : null}
//                           </div>
//                           <div
//                             className={classNames(
//                               "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
//                               done ? "bg-success-400 text-white" : "bg-slate-200 text-slate-700"
//                             )}
//                             title={done ? "Complete" : "Not complete"}
//                           >
//                             {done ? "✓" : ""}
//                           </div>
//                         </div>
//                       </button>
//                     );
//                   })}
//                 </div>

//                 <div className="mt-4 flex flex-wrap gap-2">
//                   <button
//                     className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                     onClick={() => router.push(`/plans/${encodeURIComponent(planId)}`)}
//                   >
//                     Back to plan
//                   </button>

//                   <button
//                     className={classNames(
//                       "rounded-md px-3 py-2 text-sm text-white",
//                       saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                     )}
//                     disabled={saving}
//                     onClick={() => saveHandbookProgress(activeKey, sectionsState)}
//                   >
//                     {saving ? "Saving..." : "Save"}
//                   </button>

//                   {saveMsg ? (
//                     <span className="px-2 py-2 text-sm font-medium text-success-500">{saveMsg}</span>
//                   ) : null}
//                 </div>
//               </div>
//             </div>

//             {/* Main content */}
//             <div className="md:col-span-2">
//               <div className="rounded-2xl border border-slate-200 bg-white p-6">
//                 {fetching ? (
//                   <div className="text-sm text-slate-600">Loading...</div>
//                 ) : (
//                   <>
//                     {/* SECTION 0 (Kickoff / Explanation) */}
//                     {activeKey === PROFILE_SECTION.key ? (
//                       <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
//                         <div className="text-xs font-semibold text-slate-600">Section 0</div>

//                         <h2 className="mt-2 text-2xl font-semibold text-slate-900">
//                           {(orgName || "Your organization").trim()} Fund Development Handbook
//                         </h2>

//                         <p className="mt-3 text-sm text-slate-700">
//                           You’ll build your handbook one section at a time. For each section, the AI will:
//                         </p>

//                         <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
//                           <li>Generate a small set of questions (up to 6) based on what it still needs.</li>
//                           <li>You answer the questions.</li>
//                           <li>AI drafts the section in your template format, then you review and edit.</li>
//                         </ol>

//                         <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
//                           <div className="text-sm font-semibold text-slate-900">Website permission</div>
//                           <p className="mt-1 text-sm text-slate-700">
//                             If you provided your website and granted permission during onboarding, the AI may use publicly
//                             available information from your site to reduce the number of questions it asks.
//                           </p>
//                         </div>

//                         <div className="mt-6 flex flex-wrap items-center gap-2">
//                           <button
//                             type="button"
//                             className={classNames(
//                               "rounded-md px-4 py-2 text-sm text-white",
//                               saving ? "bg-slate-400 cursor-not-allowed" : "bg-success-400 hover:bg-success-500"
//                             )}
//                             disabled={saving}
//                             onClick={async () => {
//                               const nextKey = SECTIONS[0]?.key ?? PROFILE_SECTION.key;
//                               setProfileCompleted(true);
//                               setActiveKey(nextKey);
//                               await saveHandbookProgress(nextKey, sectionsState, true);
//                             }}
//                           >
//                             {saving ? "Saving..." : "Complete section"}
//                           </button>

//                           <span className="text-xs text-slate-600">This unlocks the rest of the handbook sections.</span>
//                         </div>
//                       </div>
//                     ) : (
//                       <>
//                         {/* Section header */}
//                         <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
//                           <div>
//                             <h2 className="text-xl font-semibold text-slate-900">{activeSection.title}</h2>
//                             <p className="mt-1 text-sm text-slate-600">
//                               Step 1: Ask questions with AI. Step 2: Answer. Step 3: Generate section.
//                             </p>
//                           </div>
//                           <div className="flex items-center gap-2">
//                             <button
//                               className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                               onClick={goPrevSectionAndSave}
//                             >
//                               Back
//                             </button>
//                             <button
//                               className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                               onClick={goNextSectionAndSave}
//                             >
//                               Next
//                             </button>
//                           </div>
//                         </div>

//                         {/* AI-only CTA (no hardcoded prompts) */}
//                         {!hasQuestions && !started ? (
//                           <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5">
//                             <div className="text-sm font-semibold text-slate-900">No questions yet</div>
//                             <p className="mt-1 text-sm text-slate-700">
//                               Click below to have AI generate the questions needed for this section.
//                             </p>
//                             <div className="mt-4 flex flex-wrap items-center gap-2">
//                               <button
//                                 type="button"
//                                 className={classNames(
//                                   "rounded-md px-3 py-2 text-sm text-white",
//                                   saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                                 )}
//                                 disabled={saving}
//                                 onClick={async () => {
//                                   try {
//                                     const { questions, templateHash, questionsGeneratedAt } = await fetchAIQuestions(
//                                       activeKey
//                                     );

//                                     const cur =
//                                       sectionsState[activeKey] ??
//                                       ({
//                                         base: BASE_TEMPLATES[activeKey] ?? "",
//                                         content: "",
//                                         answers: {},
//                                         completed: false,
//                                         revealed: false,
//                                         dirty: false,
//                                         started: false,
//                                         typed: false,
//                                       } as HandbookSectionState);

//                                     const next = {
//                                       ...sectionsState,
//                                       [activeKey]: {
//                                         ...cur,
//                                         aiQuestions: questions,
//                                         templateHash,
//                                         questionsGeneratedAt,
//                                         started: false,
//                                         typed: false,
//                                       },
//                                     };

//                                     setSectionsState(next);
//                                     await saveHandbookProgress(activeKey, next);
//                                   } catch (e: any) {
//                                     alert(e?.message || "Failed to generate AI questions");
//                                   }
//                                 }}
//                               >
//                                 Ask questions with AI
//                               </button>
//                               <div className="text-xs text-slate-600">AI will generate up to 6 questions (only what it needs).</div>
//                             </div>
//                           </div>
//                         ) : null}

//                         {/* Prompts panel (AI-only) */}
//                         {showQuestionsPanel ? (
//                           <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
//                             <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
//                               <div>
//                                 <div className="text-sm font-semibold text-slate-900">AI questions</div>
//                                 <div className="mt-1 text-xs text-slate-600">
//                                   Answer all required questions, then click Generate section.
//                                 </div>
//                               </div>
//                               <div className="flex flex-wrap items-center gap-2">
//                                 <button
//                                   type="button"
//                                   className={classNames(
//                                     "rounded-md px-3 py-2 text-sm text-white",
//                                     saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                                   )}
//                                   disabled={saving}
//                                   onClick={async () => {
//                                     try {
//                                       const { questions, templateHash, questionsGeneratedAt } = await fetchAIQuestions(
//                                         activeKey
//                                       );
//                                       const cur = sectionsState[activeKey];
//                                       if (!cur) return;

//                                       const next = {
//                                         ...sectionsState,
//                                         [activeKey]: {
//                                           ...cur,
//                                           aiQuestions: questions,
//                                           templateHash,
//                                           questionsGeneratedAt,
//                                           started: false,
//                                           typed: false,
//                                           // answers: {}, // optional if you want to clear on regen
//                                         },
//                                       };

//                                       setSectionsState(next);
//                                       await saveHandbookProgress(activeKey, next);
//                                     } catch (e: any) {
//                                       alert(e?.message || "Failed to regenerate questions");
//                                     }
//                                   }}
//                                 >
//                                   Regenerate questions
//                                 </button>

//                                 <button
//                                   type="button"
//                                   className={classNames(
//                                     "rounded-md px-3 py-2 text-sm text-white",
//                                     saving || !promptsComplete
//                                       ? "bg-slate-300 cursor-not-allowed"
//                                       : "bg-success-400 hover:bg-success-500"
//                                   )}
//                                   disabled={saving || !promptsComplete}
//                                   onClick={async () => {
//                                     const st = sectionsState[activeKey];
//                                     if (!st) return;

//                                     try {
//                                       // Clear typing so we can re-run animation
//                                       setTypingMap((prev) => {
//                                         const n = { ...prev };
//                                         delete n[activeKey];
//                                         return n;
//                                       });

//                                       const { draftContent, templateHash, generatedAt } = await generateSectionWithAI(
//                                         activeKey,
//                                         st.answers,
//                                         st.aiQuestions
//                                       );

//                                       const next = {
//                                         ...sectionsState,
//                                         [activeKey]: {
//                                           ...st,
//                                           content: draftContent,
//                                           revealed: true,
//                                           started: true,
//                                           typed: false, // allow animation
//                                           dirty: false, // AI draft is not a manual edit
//                                           templateHash: templateHash ?? st.templateHash,
//                                           generatedAt,
//                                         },
//                                       };

//                                       setSectionsState(next);
//                                       await saveHandbookProgress(activeKey, next);
//                                     } catch (e: any) {
//                                       alert(e?.message || "Failed to generate section");
//                                     }
//                                   }}
//                                 >
//                                   Generate section
//                                 </button>
//                               </div>
//                             </div>

//                             <div className="mt-4 grid gap-4 sm:grid-cols-2">
//                               {activeQuestions.map((q) => {
//                                 const val = activeState?.answers?.[q.id] ?? "";
//                                 const isTextarea = q.type === "textarea";
//                                 const isSelect = q.type === "select";

//                                 return (
//                                   <div key={q.id} className={isTextarea ? "sm:col-span-2" : ""}>
//                                     <label className="text-sm font-medium text-slate-900">
//                                       {q.label}
//                                       {q.required ? <span className="text-rose-600"> *</span> : null}
//                                     </label>
//                                     {q.helper ? <div className="mt-1 text-xs text-slate-600">{q.helper}</div> : null}

//                                     {isSelect ? (
//                                       <select
//                                         className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                         value={val}
//                                         onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
//                                       >
//                                         <option value="">{q.placeholder ?? "Select one"}</option>
//                                         {(q.options ?? []).map((opt) => (
//                                           <option key={opt} value={opt}>
//                                             {opt}
//                                           </option>
//                                         ))}
//                                       </select>
//                                     ) : isTextarea ? (
//                                       <textarea
//                                         className="mt-2 min-h-[110px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                         placeholder={q.placeholder}
//                                         value={val}
//                                         onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
//                                       />
//                                     ) : (
//                                       <input
//                                         className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                         placeholder={q.placeholder}
//                                         value={val}
//                                         onChange={(e) => updateSectionAnswer(activeKey, q.id, e.target.value)}
//                                       />
//                                     )}
//                                   </div>
//                                 );
//                               })}
//                             </div>
//                           </div>
//                         ) : null}

//                         {/* Draft area */}
//                         <div className="mt-5">
//                           <label className="text-sm font-medium text-slate-900">Section text</label>

//                           {!showDraft ? (
//                             <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
//                               <div className="text-sm font-semibold text-slate-900">Hidden until you generate</div>
//                               <p className="mt-1 text-sm text-slate-700">
//                                 Ask questions, answer them, then click <span className="font-medium">Generate section</span>.
//                               </p>
//                             </div>
//                           ) : (
//                             <div className="relative">
//                               <textarea
//                                 className="mt-2 min-h-[320px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
//                                 value={draftValue}
//                                 onChange={(e) => setActiveContent(e.target.value)}
//                                 disabled={isTyping}
//                               />
//                               {isTyping ? (
//                                 <div className="absolute right-3 top-3 rounded-full bg-slate-900 px-3 py-1 text-xs text-white">
//                                   Writing…
//                                 </div>
//                               ) : null}
//                             </div>
//                           )}

//                           <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
//                             <div className="text-xs text-slate-600">
//                               {isTyping ? "Please wait while the section finishes writing." : "You can edit once writing finishes."}
//                             </div>

//                             <div className="flex items-center gap-2">
//                               <button
//                                 className={classNames(
//                                   "rounded-md px-3 py-2 text-sm text-white",
//                                   saving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                                 )}
//                                 disabled={saving}
//                                 onClick={() => saveHandbookProgress(activeKey, sectionsState)}
//                               >
//                                 {saving ? "Saving..." : "Save"}
//                               </button>

//                               <button
//                                 className={classNames(
//                                   "rounded-md px-3 py-2 text-sm text-white",
//                                   showDraft && !isTyping && (activeState?.content ?? "").trim().length >= 50
//                                     ? "bg-success-400 hover:bg-success-500"
//                                     : "bg-slate-300 cursor-not-allowed"
//                                 )}
//                                 disabled={!showDraft || isTyping || (activeState?.content ?? "").trim().length < 50}
//                                 onClick={async () => {
//                                   const cur = sectionsState[activeKey];
//                                   if (!cur) return;

//                                   const next = {
//                                     ...sectionsState,
//                                     [activeKey]: { ...cur, completed: true, typed: true },
//                                   };

//                                   setSectionsState(next);

//                                   const nextKey = goNextKey(activeKey);
//                                   setActiveKey(nextKey);
//                                   await saveHandbookProgress(nextKey, next);
//                                 }}
//                               >
//                                 Complete section
//                               </button>

//                               <button
//                                 className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
//                                 onClick={async () => {
//                                   const cur = sectionsState[activeKey];
//                                   if (!cur) return;

//                                   const next = { ...sectionsState, [activeKey]: { ...cur, completed: false } };
//                                   setSectionsState(next);
//                                   await saveHandbookProgress(activeKey, next);
//                                 }}
//                               >
//                                 Mark incomplete
//                               </button>
//                             </div>
//                           </div>
//                         </div>
//                       </>
//                     )}
//                   </>
//                 )}
//               </div>
//             </div>
//           </div>

//           {/* Sticky export bar (always available) */}
//           <div className="sticky bottom-0 mt-6">
//             <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
//               <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
//                 <div className="min-w-0">
//                   <div className="text-sm font-semibold text-slate-900">Download your handbook</div>
//                   <div className="mt-1 text-xs text-slate-600">
//                     Exports the latest saved content (including incomplete sections).
//                   </div>
//                 </div>

//                 <div className="flex flex-wrap items-center gap-2">
//                   <button
//                     type="button"
//                     className={classNames(
//                       "rounded-md px-3 py-2 text-sm text-white",
//                       exporting ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
//                     )}
//                     disabled={Boolean(exporting)}
//                     onClick={() => downloadHandbook("pdf")}
//                   >
//                     {exporting === "pdf" ? "Generating PDF..." : "Download PDF"}
//                   </button>

//                   <button
//                     type="button"
//                     className={classNames(
//                       "rounded-md px-3 py-2 text-sm text-white",
//                       exporting ? "bg-slate-400 cursor-not-allowed" : "bg-success-400 hover:bg-success-500"
//                     )}
//                     disabled={Boolean(exporting)}
//                     onClick={() => downloadHandbook("docx")}
//                   >
//                     {exporting === "docx" ? "Generating Word..." : "Download Word (.docx)"}
//                   </button>
//                 </div>

//                 <button
//                   type="button"
//                   className={classNames(
//                     "rounded-md px-3 py-2 text-sm text-white",
//                     approving ? "bg-slate-400 cursor-not-allowed" : "bg-success-400 hover:bg-success-500"
//                   )}
//                   disabled={approving}
//                   onClick={approveHandbook}
//                 >
//                   {approving ? "Approving..." : "Approve Fund Development Handbook"}
//                 </button>
//               </div>
//             </div>
//           </div>

//           <p className="mt-6 text-xs text-slate-500">
//             AI-only section flow: Ask questions → Answer → Generate section → Review/edit → Save/complete. Word-by-word animation runs only the first time unless answers change.
//           </p>
//         </div>
//       </div>
//     </main>
//   );
// }



