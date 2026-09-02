"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  DollarSign,
  History,
  Play,
  Plus,
  Square,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

type Member = {
  uid: string;
  name: string | null;
  email: string | null;
  role: string;
  status: string;
};

type TimeProject = {
  id: string;
  ownerUid: string;
  ownerName: string | null;
  name: string;
  contractStart: string | null;
  contractEnd: string | null;
  baselineHours: number;
  contractHours: number;
  contractAmountCents: number;
  status: "active" | "completed";
  completedHours: number | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type TimeEntry = {
  id: string;
  projectId: string;
  ownerUid: string;
  source: "timer" | "manual";
  workDate: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ActiveTimer = {
  ownerUid: string;
  projectId: string;
  entryId: string | null;
  workDate: string | null;
  startedAt: string;
};

type TimePayload = {
  ok: boolean;
  currentUserId: string;
  selectedUserId: string;
  members: Member[];
  projects: TimeProject[];
  entries: TimeEntry[];
  activeTimer: ActiveTimer | null;
  error?: string;
};

type ProjectMetrics = {
  trackedSeconds: number;
  actualLoggedHours: number;
  loggedHours: number;
  remainingHours: number;
  percentage: number;
  entryCount: number;
  projectedHourlyRate: number | null;
  actualHourlyRate: number | null;
};

type ContractConfirmation = {
  kind: "complete" | "remove";
  projectId: string;
};

function localDateInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateInputValue(date);
}

function roundedClockTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(Math.floor(date.getMinutes() / 15) * 15).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatHours(hours: number) {
  return hours.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.max(0, amountCents) / 100);
}

function formatHourlyRate(rate: number | null) {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rate)}/hr`;
}

function formatEntryDuration(seconds: number | null) {
  if (seconds === null) return "Running";
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function memberLabel(member: Member) {
  if (member.name && member.email) return `${member.name} · ${member.email}`;
  return member.name || member.email || "Organization member";
}

function projectIsClosed(project: TimeProject) {
  return project.status === "completed" || Boolean(project.completedAt);
}

function projectState(project: TimeProject, metrics: ProjectMetrics) {
  const today = localDateInputValue();
  if (projectIsClosed(project)) {
    return { label: "Completed", className: "border-slate-300 bg-slate-100 text-slate-700" };
  }
  if (metrics.remainingHours <= 0) {
    return { label: "Hours fulfilled", className: "border-success-200 bg-success-50 text-success-700" };
  }
  if (project.contractStart && project.contractStart > today) {
    return { label: "Upcoming", className: "border-primary-200 bg-primary-50 text-primary-700" };
  }
  if (project.contractEnd && project.contractEnd < today) {
    return { label: "Past end date", className: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  return { label: "Active", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
}

function contractTimelinePercentage(project: TimeProject) {
  if (!project.contractStart || !project.contractEnd) return 0;
  const start = new Date(`${project.contractStart}T00:00:00`).getTime();
  const end = new Date(`${project.contractEnd}T23:59:59`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100));
}

export default function TimeManagementPage() {
  const { user, loading: authLoading, activeOrgId, authedFetch } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<TimeProject[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contractOpen, setContractOpen] = useState(false);
  const [contractName, setContractName] = useState("");
  const [contractStart, setContractStart] = useState(localDateInputValue());
  const [contractEnd, setContractEnd] = useState(addDays(localDateInputValue(), 90));
  const [baselineHours, setBaselineHours] = useState("0");
  const [remainingHours, setRemainingHours] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [contractSaving, setContractSaving] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(localDateInputValue());
  const [entryStart, setEntryStart] = useState(roundedClockTime(new Date()));
  const [entryEnd, setEntryEnd] = useState(roundedClockTime(new Date(Date.now() + 60 * 60 * 1000)));
  const [entryNotes, setEntryNotes] = useState("");
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [timerBusyProjectId, setTimerBusyProjectId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [contractConfirmation, setContractConfirmation] = useState<ContractConfirmation | null>(null);
  const [contractActionBusy, setContractActionBusy] = useState(false);
  const [contractActionError, setContractActionError] = useState<string | null>(null);

  const effectiveUserId = selectedUserId || user?.uid || "";
  const viewingSelf = Boolean(user && effectiveUserId === user.uid);

  const loadTimeData = useCallback(
    async (userId: string, quiet = false) => {
      if (!user || !activeOrgId || !userId) return;
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await authedFetch(`/api/time?userId=${encodeURIComponent(userId)}`);
        const payload = (await response.json().catch(() => ({}))) as Partial<TimePayload>;
        if (!response.ok || !payload.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "Failed to load time management.");
        }

        const nextProjects = Array.isArray(payload.projects) ? payload.projects : [];
        setMembers(Array.isArray(payload.members) ? payload.members : []);
        setProjects(nextProjects);
        setEntries(Array.isArray(payload.entries) ? payload.entries : []);
        setActiveTimer(payload.activeTimer ?? null);
        setSelectedProjectId((current) =>
          current && nextProjects.some((project) => project.id === current)
            ? current
            : nextProjects[0]?.id ?? null,
        );
      } catch (loadError: unknown) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load time management.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeOrgId, authedFetch, user],
  );

  useEffect(() => {
    if (!user || !activeOrgId) return;
    if (!selectedUserId) {
      setSelectedUserId(user.uid);
      return;
    }
    void loadTimeData(selectedUserId);
  }, [activeOrgId, loadTimeData, selectedUserId, user]);

  useEffect(() => {
    if (!contractOpen && !entryOpen && !contractConfirmation) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!contractSaving) setContractOpen(false);
      if (!entrySaving) setEntryOpen(false);
      if (!contractActionBusy) setContractConfirmation(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contractActionBusy, contractConfirmation, contractOpen, contractSaving, entryOpen, entrySaving]);

  const entriesByProject = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    entries.forEach((entry) => {
      const existing = map.get(entry.projectId) ?? [];
      existing.push(entry);
      map.set(entry.projectId, existing);
    });
    return map;
  }, [entries]);

  const metricsByProject = useMemo(() => {
    const map = new Map<string, ProjectMetrics>();
    projects.forEach((project) => {
      const projectEntries = entriesByProject.get(project.id) ?? [];
      const completedSeconds = projectEntries.reduce(
        (sum, entry) => sum + (entry.durationSeconds ?? 0),
        0,
      );
      const trackedSeconds = completedSeconds;
      const actualLoggedHours = project.baselineHours + trackedSeconds / 3600;
      const completed = project.status === "completed" || Boolean(project.completedAt);
      const loggedHours = completed
        ? project.completedHours ?? project.contractHours
        : actualLoggedHours;
      const remaining = completed ? 0 : Math.max(0, project.contractHours - actualLoggedHours);
      const percentage = project.contractHours > 0 ? Math.min(100, (loggedHours / project.contractHours) * 100) : 0;
      map.set(project.id, {
        trackedSeconds,
        actualLoggedHours,
        loggedHours,
        remainingHours: remaining,
        percentage,
        entryCount: projectEntries.filter((entry) => entry.durationSeconds !== null).length,
        projectedHourlyRate:
          project.contractAmountCents > 0 && project.contractHours > 0
            ? project.contractAmountCents / 100 / project.contractHours
            : null,
        actualHourlyRate:
          completed && project.contractAmountCents > 0 && actualLoggedHours > 0
            ? project.contractAmountCents / 100 / actualLoggedHours
            : null,
      });
    });
    return map;
  }, [entriesByProject, projects]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedMetrics = selectedProject ? metricsByProject.get(selectedProject.id) ?? null : null;
  const selectedEntries = selectedProject ? entriesByProject.get(selectedProject.id) ?? [] : [];
  const selectedMember = members.find((member) => member.uid === effectiveUserId) ?? null;
  const selectedProjectCompleted = selectedProject ? projectIsClosed(selectedProject) : false;
  const confirmationProject = contractConfirmation
    ? projects.find((project) => project.id === contractConfirmation.projectId) ?? null
    : null;
  const confirmationMetrics = confirmationProject
    ? metricsByProject.get(confirmationProject.id) ?? null
    : null;

  const totals = useMemo(() => {
    const currentMonth = localDateInputValue().slice(0, 7);
    const monthlyTrackedHours = entries.reduce((hours, entry) => {
      if (!entry.workDate?.startsWith(currentMonth) || entry.durationSeconds === null) return hours;
      return hours + entry.durationSeconds / 3600;
    }, 0);
    const monthlyCapacityHours = (45 * 52) / 12;

    const projectTotals = projects.reduce(
      (summary, project) => {
        const metrics = metricsByProject.get(project.id) ?? {
          trackedSeconds: 0,
          actualLoggedHours: project.baselineHours,
          loggedHours: project.baselineHours,
          remainingHours: Math.max(0, project.contractHours - project.baselineHours),
          percentage: 0,
          entryCount: 0,
          projectedHourlyRate: null,
          actualHourlyRate: null,
        };
        summary.totalContractAmountCents += project.contractAmountCents;
        if (projectIsClosed(project)) {
          summary.closedContractHours += project.contractHours;
          summary.closed += 1;
          if (metrics.actualLoggedHours > 0 && project.contractAmountCents > 0) {
            summary.actualRateContractAmountCents += project.contractAmountCents;
            summary.actualRateHours += metrics.actualLoggedHours;
          }
        } else {
          summary.currentContractHours += project.contractHours;
          summary.currentLoggedHours += metrics.loggedHours;
          summary.currentRemainingHours += metrics.remainingHours;
          summary.current += 1;
        }
        return summary;
      },
      {
        currentContractHours: 0,
        closedContractHours: 0,
        currentLoggedHours: 0,
        currentRemainingHours: 0,
        current: 0,
        closed: 0,
        totalContractAmountCents: 0,
        actualRateContractAmountCents: 0,
        actualRateHours: 0,
      },
    );
    return {
      ...projectTotals,
      monthlyTrackedHours,
      monthlyCapacityHours,
      utilization: (monthlyTrackedHours / monthlyCapacityHours) * 100,
      actualAverageBillableRate:
        projectTotals.actualRateHours > 0
          ? projectTotals.actualRateContractAmountCents / 100 / projectTotals.actualRateHours
          : null,
    };
  }, [entries, metricsByProject, projects]);

  const currentMonthLabel = new Date().toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  async function createContract(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setContractError(null);
    setContractSaving(true);
    try {
      const response = await authedFetch("/api/time", {
        method: "POST",
        body: JSON.stringify({
          name: contractName,
          contractStart,
          contractEnd,
          baselineHours: Number(baselineHours),
          remainingHours: Number(remainingHours),
          contractAmount: Number(contractAmount),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to create contract.");

      setContractOpen(false);
      setContractName("");
      setBaselineHours("0");
      setRemainingHours("");
      setContractAmount("");
      await loadTimeData(user!.uid, true);
      if (payload?.project?.id) setSelectedProjectId(payload.project.id);
    } catch (saveError: unknown) {
      setContractError(saveError instanceof Error ? saveError.message : "Failed to create contract.");
    } finally {
      setContractSaving(false);
    }
  }

  async function toggleTimer(project: TimeProject) {
    if (!viewingSelf) return;
    const isRunning = activeTimer?.projectId === project.id;
    setTimerBusyProjectId(project.id);
    setError(null);
    try {
      const response = await authedFetch(`/api/time/projects/${encodeURIComponent(project.id)}/timer`, {
        method: "POST",
        body: JSON.stringify({
          action: isRunning ? "stop" : "start",
          workDate: localDateInputValue(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Failed to ${isRunning ? "stop" : "start"} timer.`);
      await loadTimeData(user!.uid, true);
    } catch (timerError: unknown) {
      setError(timerError instanceof Error ? timerError.message : "Timer action failed.");
    } finally {
      setTimerBusyProjectId(null);
    }
  }

  function openPastHours() {
    const start = new Date();
    start.setMinutes(Math.floor(start.getMinutes() / 15) * 15, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setEntryDate(localDateInputValue());
    setEntryStart(roundedClockTime(start));
    setEntryEnd(roundedClockTime(end));
    setEntryNotes("");
    setEntryError(null);
    setEntryOpen(true);
  }

  async function addPastHours(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;
    setEntryError(null);
    setEntrySaving(true);
    try {
      const response = await authedFetch(
        `/api/time/projects/${encodeURIComponent(selectedProject.id)}/entries`,
        {
          method: "POST",
          body: JSON.stringify({ workDate: entryDate, startTime: entryStart, endTime: entryEnd, notes: entryNotes }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to add hours.");
      setEntryOpen(false);
      await loadTimeData(user!.uid, true);
    } catch (saveError: unknown) {
      setEntryError(saveError instanceof Error ? saveError.message : "Failed to add hours.");
    } finally {
      setEntrySaving(false);
    }
  }

  async function deleteEntry(entry: TimeEntry) {
    if (!window.confirm("Delete this time entry? The project total will be updated.")) return;
    setDeletingEntryId(entry.id);
    setError(null);
    try {
      const response = await authedFetch(`/api/time/entries/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to delete time entry.");
      await loadTimeData(user!.uid, true);
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete time entry.");
    } finally {
      setDeletingEntryId(null);
    }
  }

  function requestContractAction(kind: ContractConfirmation["kind"], projectId: string) {
    setContractActionError(null);
    setContractConfirmation({ kind, projectId });
  }

  async function confirmContractAction() {
    if (!contractConfirmation || !user) return;
    const { kind, projectId } = contractConfirmation;
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;

    setContractActionBusy(true);
    setContractActionError(null);
    setError(null);
    try {
      const response = await authedFetch(`/api/time/projects/${encodeURIComponent(projectId)}`, {
        method: kind === "remove" ? "DELETE" : "PATCH",
        ...(kind === "complete"
          ? {
              body: JSON.stringify({
                action: "complete",
                confirmIncomplete: true,
              }),
            }
          : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to ${kind === "remove" ? "remove" : "complete"} contract.`,
        );
      }

      setContractConfirmation(null);
      await loadTimeData(user.uid, true);
    } catch (actionError: unknown) {
      setContractActionError(
        actionError instanceof Error ? actionError.message : "Contract action failed.",
      );
    } finally {
      setContractActionBusy(false);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-screen p-6 md:p-8">
        <div className="auth-card mx-auto max-w-6xl p-6">
          <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
            Loading time management...
          </div>
        </div>
      </main>
    );
  }

  if (!user || !activeOrgId) return null;

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary-700">
                <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
                Time tracking
              </p>
              <h1 className="workspace-page-title mt-3 text-3xl font-semibold tracking-tight">Time Management</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Track contract commitments, run a project timer, and review hours across your organization.
              </p>
            </div>

            {viewingSelf ? (
              <button
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                onClick={() => {
                  setContractError(null);
                  setContractOpen(true);
                }}
                type="button"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add new contract
              </button>
            ) : (
              <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                Read-only view
              </span>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="w-full max-w-md">
              <label className="field-label" htmlFor="team-member">
                View team member
              </label>
              <div className="relative">
                <Users aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  className="field-input appearance-none pl-10 pr-9 text-sm font-medium"
                  id="team-member"
                  onChange={(event) => {
                    setSelectedUserId(event.target.value);
                    setSelectedProjectId(null);
                  }}
                  value={effectiveUserId}
                >
                  {members.map((member) => (
                    <option key={member.uid} value={member.uid}>
                      {memberLabel(member)}{member.uid === user.uid ? " (You)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-slate-500">Currently viewing</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{selectedMember ? memberLabel(selectedMember) : "Your hours"}</p>
            </div>
          </div>
          {error ? <div className="status-box status-box-error mt-4" role="alert">{error}</div> : null}
        </section>

        {activeTimer ? (
          <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-600" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Tracking time</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">
                    {projects.find((project) => project.id === activeTimer.projectId)?.name || "Project"}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-emerald-800">Time will be recorded when stopped</p>
                <p className="mt-1 text-[11px] text-emerald-700">
                  Started {new Date(activeTimer.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Current contract hours", value: formatHours(totals.currentContractHours), note: "Active commitments", color: "text-primary-700" },
            { label: "Closed-out hours", value: formatHours(totals.closedContractHours), note: "Lifetime contract hours", color: "text-slate-700" },
            { label: "Total contract value", value: formatCurrency(totals.totalContractAmountCents), note: "Current and completed", color: "text-emerald-700" },
            { label: "Actual avg. billable", value: formatHourlyRate(totals.actualAverageBillableRate), note: "Completed contracts only", color: "text-primary-700" },
            { label: "Current completed", value: formatHours(totals.currentLoggedHours), note: "Including starting hours", color: "text-emerald-700" },
            { label: "Current remaining", value: formatHours(totals.currentRemainingHours), note: "Across active contracts", color: "text-amber-700" },
            { label: "Monthly utilization", value: `${formatHours(totals.utilization)}%`, note: `${formatHours(totals.monthlyTrackedHours)} of ${formatHours(totals.monthlyCapacityHours)}h · ${currentMonthLabel}`, color: "text-accent-700" },
            { label: "Current contracts", value: String(totals.current), note: `${totals.closed} closed out`, color: "text-slate-900" },
          ].map((item) => (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={item.label}>
              <p className="text-xs font-medium text-slate-500">{item.label}</p>
              <p className={`mt-2 break-words text-xl font-bold leading-tight tabular-nums sm:text-2xl ${item.color}`}>{item.value}</p>
              <p className="mt-1 text-[11px] text-slate-500">{item.note}</p>
            </div>
          ))}
        </section>

        <p className="px-1 text-[11px] text-slate-500">
          Completed contracts move to lifetime closed-out totals. Monthly utilization resets each calendar month, uses dated time entries only, and assumes a 195-hour capacity based on a 45-hour work week.
        </p>

        <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.78fr)]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Projects and contracts</h2>
                <p className="mt-0.5 text-xs text-slate-500">Select a contract to see its full progress and history.</p>
              </div>
              {refreshing ? <span className="text-xs font-medium text-slate-500">Updating...</span> : null}
            </div>

            {projects.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <BriefcaseBusiness aria-hidden="true" className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">No contracts yet</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {viewingSelf ? "Add your first contract to begin tracking hours." : "This member has not added any contracts."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {projects.map((project) => {
                  const metrics = metricsByProject.get(project.id)!;
                  const state = projectState(project, metrics);
                  const isSelected = selectedProjectId === project.id;
                  const isRunning = activeTimer?.projectId === project.id;
                  const anotherRunning = Boolean(activeTimer && !isRunning);
                  return (
                    <article
                      className={`cursor-pointer p-5 transition ${isSelected ? "bg-primary-50/60" : "hover:bg-slate-50"}`}
                      key={project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              className="truncate text-left text-base font-semibold text-slate-900 hover:text-primary-700"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedProjectId(project.id);
                              }}
                              type="button"
                            >
                              {project.name}
                            </button>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${state.className}`}>{state.label}</span>
                          </div>
                          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                            <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
                            {formatDate(project.contractStart)} — {formatDate(project.contractEnd)}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                            <DollarSign aria-hidden="true" className="h-3.5 w-3.5" />
                            {formatCurrency(project.contractAmountCents)} · {formatHourlyRate(metrics.projectedHourlyRate)} projected
                          </p>
                        </div>

                        {viewingSelf && !projectIsClosed(project) ? (
                          <button
                            className={
                              isRunning
                                ? "inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                                : "inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                            }
                            disabled={timerBusyProjectId !== null || anotherRunning}
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleTimer(project);
                            }}
                            title={anotherRunning ? "Stop the running timer before starting another" : undefined}
                            type="button"
                          >
                            {isRunning ? <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" /> : <Play aria-hidden="true" className="h-3.5 w-3.5 fill-current" />}
                            {timerBusyProjectId === project.id ? "Saving..." : isRunning ? "Stop timer" : "Start timer"}
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-600">{formatHours(metrics.loggedHours)} of {formatHours(project.contractHours)} hours</span>
                          <span className="font-semibold text-slate-800">{Math.round(metrics.percentage)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-emerald-500 transition-all" style={{ width: `${metrics.percentage}%` }} />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-24">
            {!selectedProject || !selectedMetrics ? (
              <div className="px-6 py-14 text-center">
                <Clock3 aria-hidden="true" className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-600">Select a contract to view details.</p>
              </div>
            ) : (
              <>
                <div className="border-b border-slate-200 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700">Contract overview</p>
                      <h2 className="mt-1 truncate text-xl font-semibold text-slate-900">{selectedProject.name}</h2>
                    </div>
                    {viewingSelf ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {!selectedProjectCompleted ? (
                          <>
                            <button className="btn-secondary shrink-0 px-3 py-2 text-xs" onClick={openPastHours} type="button">
                              <Plus aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                              Add past hours
                            </button>
                            <button
                              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={activeTimer?.projectId === selectedProject.id}
                              onClick={() => requestContractAction("complete", selectedProject.id)}
                              type="button"
                            >
                              Complete contract
                            </button>
                          </>
                        ) : null}
                        <button
                          className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={activeTimer?.projectId === selectedProject.id}
                          onClick={() => requestContractAction("remove", selectedProject.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 flex items-center gap-6">
                    <div className="relative h-32 w-32 shrink-0">
                      <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" aria-label={`${Math.round(selectedMetrics.percentage)} percent complete`}>
                        <circle cx="60" cy="60" fill="none" r="50" stroke="#e2e8f0" strokeWidth="10" />
                        <circle
                          cx="60"
                          cy="60"
                          fill="none"
                          r="50"
                          stroke="#5551a8"
                          strokeDasharray={`${selectedMetrics.percentage * 3.14159} 314.159`}
                          strokeLinecap="round"
                          strokeWidth="10"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-bold tabular-nums text-slate-900">{Math.round(selectedMetrics.percentage)}%</span>
                        <span className="text-[10px] font-medium text-slate-500">complete</span>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <p className="text-xs text-slate-500">Finished hours</p>
                        <p className="text-xl font-bold tabular-nums text-emerald-700">{formatHours(selectedMetrics.loggedHours)}h</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Remaining</p>
                        <p className="text-xl font-bold tabular-nums text-amber-700">{formatHours(selectedMetrics.remainingHours)}h</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="auth-section-card p-3">
                      <p className="text-[11px] text-slate-500">Contract amount</p>
                      <p className="mt-1 break-words text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(selectedProject.contractAmountCents)}</p>
                    </div>
                    <div className="auth-section-card p-3">
                      <p className="text-[11px] text-slate-500">Projected hourly rate</p>
                      <p className="mt-1 break-words text-sm font-semibold tabular-nums text-primary-700">{formatHourlyRate(selectedMetrics.projectedHourlyRate)}</p>
                    </div>
                    <div className="auth-section-card p-3">
                      <p className="text-[11px] text-slate-500">Actual billable rate</p>
                      <p className="mt-1 break-words text-sm font-semibold tabular-nums text-emerald-700">
                        {selectedProjectCompleted
                          ? formatHourlyRate(selectedMetrics.actualHourlyRate)
                          : "Available when completed"}
                      </p>
                    </div>
                    <div className="auth-section-card p-3">
                      <p className="text-[11px] text-slate-500">Actual hours tracked</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{formatHours(selectedMetrics.actualLoggedHours)}h</p>
                    </div>
                    <div className="auth-section-card p-3">
                      <p className="text-[11px] text-slate-500">Starting hours</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{formatHours(selectedProject.baselineHours)}h</p>
                    </div>
                    <div className="auth-section-card p-3">
                      <p className="text-[11px] text-slate-500">Tracked entries</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{selectedMetrics.entryCount}</p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex justify-between text-[11px] font-medium text-slate-500">
                      <span>{formatDate(selectedProject.contractStart)}</span>
                      <span>{formatDate(selectedProject.contractEnd)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-accent-400" style={{ width: `${contractTimelinePercentage(selectedProject)}%` }} />
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-500">Contract timeline</p>
                  </div>
                </div>

                <div className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <History aria-hidden="true" className="h-4 w-4 text-slate-500" />
                      Time history
                    </h3>
                    <span className="text-[11px] text-slate-500">{selectedEntries.length} entries</span>
                  </div>

                  {selectedEntries.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-7 text-center">
                      <p className="text-xs font-medium text-slate-600">No tracked entries yet.</p>
                    </div>
                  ) : (
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {selectedEntries.map((entry) => {
                        const startedDate = entry.startedAt ? new Date(entry.startedAt) : null;
                        const timeLabel = entry.source === "manual"
                          ? `${entry.startTime || "--:--"}–${entry.endTime || "--:--"}`
                          : startedDate && !Number.isNaN(startedDate.getTime())
                            ? `Started ${startedDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                            : "Timer entry";
                        const duration = formatEntryDuration(entry.durationSeconds);
                        return (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3" key={entry.id}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-xs font-semibold text-slate-900">{formatDate(entry.workDate)}</p>
                                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${entry.source === "timer" ? "bg-primary-100 text-primary-700" : "bg-slate-200 text-slate-600"}`}>
                                    {entry.source}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">{timeLabel}</p>
                                {entry.notes ? <p className="mt-1 truncate text-[11px] text-slate-600">{entry.notes}</p> : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold tabular-nums text-slate-800">{duration}</span>
                                {viewingSelf && !selectedProjectCompleted ? (
                                  <button
                                    aria-label="Delete time entry"
                                    className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                                    disabled={deletingEntryId === entry.id}
                                    onClick={() => void deleteEntry(entry)}
                                    type="button"
                                  >
                                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </section>
      </div>

      {contractOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="new-contract-title">
          <button className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" aria-label="Close new contract dialog" onClick={() => !contractSaving && setContractOpen(false)} type="button" />
          <section className="auth-card relative max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto p-6 md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">New work</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900" id="new-contract-title">Add new contract</h2>
                <p className="mt-1 text-sm text-slate-600">Set the dates and hour commitment for this project.</p>
              </div>
              <button className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100" disabled={contractSaving} onClick={() => setContractOpen(false)} type="button">
                <X aria-hidden="true" className="h-5 w-5" />
                <span className="sr-only">Close</span>
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={createContract}>
              <div>
                <label className="field-label" htmlFor="contract-name">Contract / project name</label>
                <input autoFocus className="field-input" id="contract-name" maxLength={120} onChange={(event) => setContractName(event.target.value)} placeholder="e.g., Community grant strategy" required value={contractName} />
              </div>
              <div>
                <label className="field-label" htmlFor="contract-amount">Contract amount</label>
                <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white transition focus-within:border-primary-400 focus-within:ring-4 focus-within:ring-primary-100">
                  <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-base font-bold text-slate-700" aria-hidden="true">$</span>
                  <input className="min-w-0 flex-1 bg-white px-3 py-2.5 text-base font-semibold tabular-nums text-slate-950 outline-none placeholder:font-normal placeholder:text-slate-400" id="contract-amount" min="0.01" onChange={(event) => setContractAmount(event.target.value)} placeholder="0.00" required step="0.01" type="number" value={contractAmount} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="contract-start">Contract start</label>
                  <input className="field-input" id="contract-start" onChange={(event) => setContractStart(event.target.value)} required type="date" value={contractStart} />
                </div>
                <div>
                  <label className="field-label" htmlFor="contract-end">Contract end</label>
                  <input className="field-input" id="contract-end" min={contractStart} onChange={(event) => setContractEnd(event.target.value)} required type="date" value={contractEnd} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="completed-hours">Hours completed to date</label>
                  <input className="field-input text-base font-semibold tabular-nums text-slate-950" id="completed-hours" min="0" onChange={(event) => setBaselineHours(event.target.value)} required step="0.25" type="number" value={baselineHours} />
                  <p className="field-help">Existing work not entered in the history.</p>
                </div>
                <div>
                  <label className="field-label" htmlFor="remaining-hours">Hours left to fulfill contract</label>
                  <input className="field-input text-base font-semibold tabular-nums text-slate-950" id="remaining-hours" min="0" onChange={(event) => setRemainingHours(event.target.value)} placeholder="0" required step="0.25" type="number" value={remainingHours} />
                  <p className="field-help">The remaining commitment today.</p>
                </div>
              </div>

              {(Number(baselineHours) > 0 || Number(remainingHours) > 0) ? (
                <div className="auth-section-card space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-600">Total contract commitment</span>
                    <span className="text-base font-bold text-slate-900">{formatHours((Number(baselineHours) || 0) + (Number(remainingHours) || 0))} hours</span>
                  </div>
                  {Number(contractAmount) > 0 ? (
                    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
                      <span className="text-sm text-slate-600">Projected hourly rate</span>
                      <span className="text-base font-bold text-primary-700">
                        {formatHourlyRate(Number(contractAmount) / ((Number(baselineHours) || 0) + (Number(remainingHours) || 0)))}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {contractError ? <div className="status-box status-box-error" role="alert">{contractError}</div> : null}
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button className="btn-secondary px-4 py-2.5 text-sm" disabled={contractSaving} onClick={() => setContractOpen(false)} type="button">Cancel</button>
                <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-700 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={contractSaving} type="submit">
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                  {contractSaving ? "Creating..." : "Submit new project"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {entryOpen && selectedProject ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="past-hours-title">
          <button className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" aria-label="Close past hours dialog" onClick={() => !entrySaving && setEntryOpen(false)} type="button" />
          <section className="auth-card relative w-full max-w-lg p-6 md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700">Time history</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900" id="past-hours-title">Add past hours</h2>
                <p className="mt-1 text-sm text-slate-600">Record earlier work for {selectedProject.name}.</p>
              </div>
              <button className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100" disabled={entrySaving} onClick={() => setEntryOpen(false)} type="button">
                <X aria-hidden="true" className="h-5 w-5" />
                <span className="sr-only">Close</span>
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={addPastHours}>
              <div>
                <label className="field-label" htmlFor="entry-date">Work date</label>
                <input autoFocus className="field-input" id="entry-date" max={localDateInputValue()} onChange={(event) => setEntryDate(event.target.value)} required type="date" value={entryDate} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label" htmlFor="entry-start">Start time</label>
                  <input className="field-input" id="entry-start" onChange={(event) => setEntryStart(event.target.value)} required type="time" value={entryStart} />
                </div>
                <div>
                  <label className="field-label" htmlFor="entry-end">End time</label>
                  <input className="field-input" id="entry-end" onChange={(event) => setEntryEnd(event.target.value)} required type="time" value={entryEnd} />
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="entry-notes">Notes <span className="font-normal text-slate-400">(optional)</span></label>
                <textarea className="field-input min-h-24 resize-y" id="entry-notes" maxLength={500} onChange={(event) => setEntryNotes(event.target.value)} placeholder="What did you work on?" value={entryNotes} />
              </div>
              {entryError ? <div className="status-box status-box-error" role="alert">{entryError}</div> : null}
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button className="btn-secondary px-4 py-2.5 text-sm" disabled={entrySaving} onClick={() => setEntryOpen(false)} type="button">Cancel</button>
                <button className="btn-primary px-5 py-2.5 text-sm" disabled={entrySaving} type="submit">{entrySaving ? "Adding hours..." : "Add to time history"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {contractConfirmation && confirmationProject && confirmationMetrics ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="contract-confirm-title">
          <button
            aria-label="Close confirmation dialog"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
            disabled={contractActionBusy}
            onClick={() => {
              setContractConfirmation(null);
              setContractActionError(null);
            }}
            type="button"
          />
          <section className="auth-card relative w-full max-w-md p-6 md:p-7">
            <div className={`flex h-11 w-11 items-center justify-center rounded-full ${contractConfirmation.kind === "remove" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
              {contractConfirmation.kind === "remove" ? (
                <Trash2 aria-hidden="true" className="h-5 w-5" />
              ) : (
                <AlertTriangle aria-hidden="true" className="h-5 w-5" />
              )}
            </div>

            <h2 className="mt-4 text-xl font-semibold text-slate-900" id="contract-confirm-title">
              {contractConfirmation.kind === "remove" ? "Remove this contract?" : "Complete this contract?"}
            </h2>

            {contractConfirmation.kind === "remove" ? (
              <p className="mt-2 text-sm leading-6 text-slate-600">
                You are about to permanently remove <span className="font-semibold text-slate-900">{confirmationProject.name}</span> and all of its time history. This cannot be undone.
              </p>
            ) : confirmationMetrics.actualLoggedHours + 0.0001 < confirmationProject.contractHours ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm font-semibold leading-6 text-amber-800">
                  You have not completed all the hours for this contract. Are you sure you want to complete it?
                </p>
                <p className="text-sm leading-6 text-slate-600">
                  Completing it will mark all <span className="font-semibold text-slate-900">{formatHours(confirmationProject.contractHours)} hours</span> as finished for the full {formatCurrency(confirmationProject.contractAmountCents)} contract. The actual rate will still use the {formatHours(confirmationMetrics.actualLoggedHours)} hours truly tracked.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-600">
                This will move <span className="font-semibold text-slate-900">{confirmationProject.name}</span> to completed contracts and mark its full {formatHours(confirmationProject.contractHours)} hours as finished.
              </p>
            )}

            {contractActionError ? (
              <div className="status-box status-box-error mt-4" role="alert">{contractActionError}</div>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="btn-secondary px-4 py-2.5 text-sm"
                disabled={contractActionBusy}
                onClick={() => {
                  setContractConfirmation(null);
                  setContractActionError(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className={
                  contractConfirmation.kind === "remove"
                    ? "rounded-xl border border-rose-700 bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    : "rounded-xl border border-emerald-700 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                }
                disabled={contractActionBusy}
                onClick={() => void confirmContractAction()}
                type="button"
              >
                {contractActionBusy
                  ? contractConfirmation.kind === "remove" ? "Removing..." : "Completing..."
                  : contractConfirmation.kind === "remove" ? "Remove contract" : "Complete contract"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
