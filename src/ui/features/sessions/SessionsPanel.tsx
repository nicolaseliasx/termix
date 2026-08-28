import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  Loader2,
  Plus,
  TerminalSquare,
  Trash2,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { getSSHHosts } from "@/main-axios";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import { SectionCard } from "@/components/section-card";
import type { Host } from "@/types/ui-types";
import {
  createPersistentSession,
  killPersistentSession,
  listPersistentSessions,
  reconcilePersistentSessions,
  patchPersistentSession,
  type PersistentSession,
} from "@/api/persistent-sessions-api";

const formFieldClass =
  "h-8 w-full rounded-none border border-input bg-transparent px-2 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

function formatRuntime(createdAt: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
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
  onRegisterRefresh,
}: {
  onAttach: (session: PersistentSession, host: Host) => void;
  /** Lets the shell header trigger the same refresh the panel polls with. */
  onRegisterRefresh?: (refresh: () => Promise<void>) => void;
}) {
  const [sessions, setSessions] = useState<PersistentSession[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [hostId, setHostId] = useState("");
  const [name, setName] = useState("");
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [Number(host.id), host])),
    [hosts],
  );
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setError(null);
      const connectivity = await reconcilePersistentSessions(signal);
      const [page, rawHosts] = await Promise.all([
        listPersistentSessions(signal),
        getSSHHosts(),
      ]);
      if (signal?.aborted) return;
      const statusByHost = new Map(
        connectivity.map((host) => [host.hostId, host.status]),
      );
      setSessions(page.data);
      setHosts(
        rawHosts.map(sshHostToHost).map((host) => ({
          ...host,
          online: statusByHost.get(Number(host.id)) === "online",
        })),
      );
    } catch (reason) {
      if (!signal?.aborted) setError(errorText(reason));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);
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
      await createPersistentSession({
        hostId: Number(hostId),
        displayName: name.trim(),
        tmuxSessionName: name.trim(),
      });
      setName("");
      await refresh();
      toast.success("Persistent session created");
    } catch (reason) {
      toast.error(errorText(reason));
    } finally {
      setCreating(false);
    }
  }
  async function terminate(session: PersistentSession) {
    if (
      !window.confirm(
        `Terminate ${session.displayName}? The remote tmux process will be stopped.`,
      )
    )
      return;
    try {
      await killPersistentSession(session.id);
      await refresh();
      toast.success("Session terminated");
    } catch (reason) {
      toast.error(errorText(reason));
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
            <option value="">Select a host</option>
            {hosts.map((host) => (
              <option value={host.id} key={host.id} disabled={!host.online}>
                {host.name}
                {host.online ? "" : " (offline)"}
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
            disabled={creating || !hostId || !name.trim()}
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
          No persistent sessions yet. Create one to keep a terminal running when
          you close the browser.
        </div>
      ) : (
        <ul className="space-y-2" aria-live="polite">
          {sessions.map((session) => {
            const host = hostById.get(session.hostId);
            const ended = Boolean(session.endedAt);
            const offline = !host?.online;
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
                        onClick={() => void terminate(session)}
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ended
                        ? session.endReason || "terminated"
                        : offline
                          ? "offline"
                          : "running"}{" "}
                      · {formatRuntime(session.createdAt)} ·{" "}
                      {session.expiryMode === "manual"
                        ? "manual expiry"
                        : `expires ${session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "after detach"}`}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        disabled={ended || offline || !host}
                        onClick={() => host && onAttach(session, host)}
                      >
                        <TerminalSquare className="mr-1 size-4" />
                        Attach
                      </Button>
                      {offline && (
                        <span className="flex items-center gap-1 self-center text-xs text-muted-foreground">
                          <WifiOff className="size-3" />
                          Host offline
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
  );
}
