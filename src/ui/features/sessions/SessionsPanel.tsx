import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  Columns2,
  Loader2,
  Plus,
  Snowflake,
  TerminalSquare,
  Trash2,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog";
import { getSSHHosts } from "@/main-axios";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import { SectionCard } from "@/components/section-card";
import type { Host } from "@/types/ui-types";
import {
  createPersistentSession,
  killPersistentSession,
  listPersistentSessions,
  patchPersistentSession,
  type PersistentSession,
} from "@/api/persistent-sessions-api";
import { useOptionalServerStatus } from "@/lib/ServerStatusContext";

type HostAvailability =
  "online" | "reachable" | "offline" | "degraded" | "checking" | "disabled";
function formatHostStatus(status: HostAvailability): string {
  return status === "disabled" ? "monitoring disabled" : status;
}

const formFieldClass =
  "h-8 w-full rounded-none border border-input bg-transparent px-2 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

// Host that is pre-selected whenever it is online, labeled "(default)" in
// the host picker.
const DEFAULT_HOST_NAME = "devhub";

function isDefaultHost(host: Host): boolean {
  return host.name.trim().toLowerCase() === DEFAULT_HOST_NAME;
}

// Coarse, non-ticking age: a per-second stopwatch next to every card reads as
// a countdown nobody asked for. Minutes are shown until an hour, then hours,
// then days — the panel polls every 30s, which is plenty for this precision.
function formatAge(iso: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ${hours % 24}h`;
  return `${Math.floor(days / 7)}w`;
}
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed";
  if (message.includes("CONFLICT"))
    return "This session is already in use. Refresh and try again.";
  if (message.includes("OFFLINE")) return "The host is offline.";
  return message;
}
export function SessionsPanel({
  onAttach,
  onAttachSplit,
  onTerminate,
  onRegisterRefresh,
}: {
  onAttach: (session: PersistentSession, host: Host) => void;
  /** Attach the session inside a side-by-side split view. */
  onAttachSplit?: (session: PersistentSession, host: Host) => void;
  onTerminate?: (session: PersistentSession) => void;
  /** Lets the shell header trigger the same refresh the panel polls with. */
  onRegisterRefresh?: (refresh: () => Promise<void>) => void;
}) {
  const [sessions, setSessions] = useState<PersistentSession[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sessionToTerminate, setSessionToTerminate] =
    useState<PersistentSession | null>(null);
  const [terminating, setTerminating] = useState(false);
  const [terminateError, setTerminateError] = useState<string | null>(null);
  const [hostId, setHostId] = useState("");
  const [name, setName] = useState("");
  const serverStatus = useOptionalServerStatus();
  const statuses = serverStatus?.statuses;
  const getStatus = serverStatus?.getStatus;
  const refreshStatuses = serverStatus?.refreshStatuses;
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [Number(host.id), host])),
    [hosts],
  );
  const getHostAvailability = useCallback(
    (id: number): HostAvailability => {
      const host = hostById.get(id);
      if (host?.statsConfig?.statusCheckEnabled === false) return "disabled";
      if (!serverStatus) {
        const rawStatus = host?.status;
        return rawStatus === "online" ||
          rawStatus === "reachable" ||
          rawStatus === "offline"
          ? rawStatus
          : "checking";
      }
      if (statuses?.has(id)) return statuses.get(id)!.status;
      return getStatus && serverStatus?.initialLoadComplete
        ? getStatus(id)
        : "checking";
    },
    [getStatus, hostById, serverStatus, statuses],
  );
  const onlineHosts = useMemo(
    () =>
      hosts.filter((host) => getHostAvailability(Number(host.id)) === "online"),
    [getHostAvailability, hosts],
  );
  useEffect(() => {
    if (hostId && getHostAvailability(Number(hostId)) !== "online") {
      setHostId("");
    }
  }, [getHostAvailability, hostId]);
  // Keep the default host pre-selected whenever it is available, so the
  // create form is always ready to submit for it.
  useEffect(() => {
    if (hostId) return;
    const defaultHost = onlineHosts.find(isDefaultHost);
    if (defaultHost) setHostId(String(defaultHost.id));
  }, [hostId, onlineHosts]);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setError(null);
        const [page, rawHosts] = await Promise.all([
          listPersistentSessions(signal),
          getSSHHosts({ includeStatus: false }),
        ]);
        if (signal?.aborted) return;
        setSessions(page.data);
        setHosts(rawHosts.map(sshHostToHost));
        if (refreshStatuses) await refreshStatuses();
      } catch (reason) {
        if (!signal?.aborted) setError(errorText(reason));
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [refreshStatuses],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    onRegisterRefresh?.(refresh);
  }, [onRegisterRefresh, refresh]);
  useEffect(() => {
    if (document.hidden) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!hostId || !name.trim()) return;
    setCreating(true);
    try {
      if (refreshStatuses) await refreshStatuses();
      const currentStatus = getHostAvailability(Number(hostId));
      if (currentStatus !== "online") {
        throw new Error(
          `Host is currently ${formatHostStatus(currentStatus)}. Wait until it is online and try again.`,
        );
      }
      const session = await createPersistentSession({
        hostId: Number(hostId),
        displayName: name.trim(),
        tmuxSessionName: name.trim(),
      });
      const host = hostById.get(session.hostId);
      if (host) onAttach(session, host);
      setName("");
      await refresh();
      toast.success("Session has been created");
    } catch (reason) {
      toast.error(errorText(reason));
    } finally {
      setCreating(false);
    }
  }
  async function terminate(force = false) {
    const session = sessionToTerminate;
    if (!session) return;
    setTerminating(true);
    try {
      await killPersistentSession(session.id, { force });
      onTerminate?.(session);
      await refresh();
      toast.success(force ? "Session removed locally" : "Session terminated");
      setSessionToTerminate(null);
      setTerminateError(null);
    } catch (reason) {
      // Keep the dialog open: the failure is usually a dead host or a
      // marker wiped by a tmux restart, and the force path is the way out
      // for records that can never be terminated the guarded way.
      setTerminateError(errorText(reason));
    } finally {
      setTerminating(false);
    }
  }
  async function rename(session: PersistentSession) {
    const next = window.prompt("Session name", session.displayName)?.trim();
    if (!next || next === session.displayName) return;
    try {
      await patchPersistentSession(session.id, {
        displayName: next,
        tmuxSessionName: next,
      });
      await refresh();
    } catch (reason) {
      toast.error(errorText(reason));
    }
  }
  return (
    <>
      <section
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3"
        aria-label="Persistent sessions"
      >
        <SectionCard
          title="Create session"
          icon={<TerminalSquare className="size-4" />}
          className="mb-4"
        >
          <form
            onSubmit={submit}
            className="grid gap-2 py-2"
            aria-label="Create persistent session"
          >
            <label className="text-xs font-medium" htmlFor="persistent-host">
              Host
            </label>
            <select
              id="persistent-host"
              className={formFieldClass}
              value={hostId}
              onChange={(event) => setHostId(event.target.value)}
              required
            >
              <option value="">
                {onlineHosts.length === 0
                  ? "No online hosts available"
                  : "Select a host"}
              </option>
              {onlineHosts.map((host) => (
                <option value={host.id} key={host.id}>
                  {host.name}
                  {isDefaultHost(host) ? " (default)" : ""}
                </option>
              ))}
            </select>
            <label className="text-xs font-medium" htmlFor="persistent-name">
              Name
            </label>
            <input
              id="persistent-name"
              className={formFieldClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
              required
              placeholder="codex-termix"
            />
            <Button
              type="submit"
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={
                creating ||
                !hostId ||
                !name.trim() ||
                getHostAvailability(Number(hostId)) !== "online"
              }
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}{" "}
              Create session
            </Button>
          </form>
        </SectionCard>
        {error && (
          <div
            role="alert"
            className="mb-3 flex gap-2 rounded border border-destructive/50 p-3 text-sm"
          >
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="border border-dashed p-6 text-center text-sm text-muted-foreground">
            No persistent sessions yet. Create one to keep a terminal running
            when you close the browser.
          </div>
        ) : (
          <ul className="space-y-2" aria-live="polite">
            {sessions.map((session) => {
              const host = hostById.get(session.hostId);
              const ended = Boolean(session.endedAt);
              const status = host
                ? getHostAvailability(Number(host.id))
                : "offline";
              return (
                <li key={session.id}>
                  <SectionCard
                    title={session.displayName}
                    icon={<TerminalSquare className="size-4" />}
                    action={
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Rename session"
                          onClick={() => void rename(session)}
                          disabled={ended}
                        >
                          ✎
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Terminate remote session"
                          onClick={() => {
                            setTerminateError(null);
                            setSessionToTerminate(session);
                          }}
                          disabled={ended}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    }
                  >
                    <div className="py-2">
                      <p className="truncate text-xs text-muted-foreground">
                        {host?.name ?? `Host #${session.hostId}`}
                      </p>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        {session.hibernatedAt && !ended && (
                          <Snowflake
                            className="size-3 shrink-0 text-sky-400"
                            aria-label="Session is in standby"
                          />
                        )}
                        <p className="truncate">
                          {ended
                            ? session.endReason || "terminated"
                            : session.hibernatedAt
                              ? `standby · frozen ${formatAge(session.hibernatedAt)} · up ${formatAge(session.createdAt)}`
                              : status === "online"
                                ? `running · up ${formatAge(session.createdAt)}`
                                : formatHostStatus(status) + " · not available"}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          disabled={ended || status !== "online" || !host}
                          onClick={() => host && onAttach(session, host)}
                        >
                          <TerminalSquare className="mr-1 size-4" />
                          Attach
                        </Button>
                        {onAttachSplit && (
                          <Button
                            size="sm"
                            variant="outline"
                            title="Attach in split view"
                            disabled={ended || status !== "online" || !host}
                            onClick={() => host && onAttachSplit(session, host)}
                          >
                            <Columns2 className="mr-1 size-4" />
                            Split
                          </Button>
                        )}
                        {status !== "online" && (
                          <span className="flex items-center gap-1 self-center text-xs text-muted-foreground">
                            <WifiOff className="size-3" />
                            Host {formatHostStatus(status)}
                          </span>
                        )}
                      </div>
                    </div>
                  </SectionCard>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <AlertDialog
        open={sessionToTerminate !== null}
        onOpenChange={(open) => {
          if (!open && !terminating) {
            setSessionToTerminate(null);
            setTerminateError(null);
          }
        }}
      >
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate session?</AlertDialogTitle>
            <AlertDialogDescription>
              {sessionToTerminate
                ? `Terminate ${sessionToTerminate.displayName}? The remote tmux process will be stopped.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {terminateError && (
            <div
              role="alert"
              className="flex gap-2 rounded border border-destructive/50 p-2 text-xs"
            >
              <AlertCircle className="size-4 shrink-0" />
              <div>
                <p>{terminateError}</p>
                <p className="mt-1 text-muted-foreground">
                  Force remove kills the remote tmux session by name when no
                  other record owns it, and always clears the card.
                </p>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={terminating}>Cancel</AlertDialogCancel>
            {terminateError && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={terminating}
                onClick={(event) => {
                  event.preventDefault();
                  void terminate(true);
                }}
              >
                {terminating ? "Removing…" : "Force remove"}
              </AlertDialogAction>
            )}
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={terminating}
              onClick={(event) => {
                event.preventDefault();
                void terminate(false);
              }}
            >
              {terminating ? "Terminating…" : "Terminate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
