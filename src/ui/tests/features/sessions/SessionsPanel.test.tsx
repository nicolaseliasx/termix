import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SSHHostWithStatus } from "@/main-axios";
import type { PersistentSession } from "@/api/persistent-sessions-api";
import { SessionsPanel } from "@/features/sessions/SessionsPanel";

const mocks = vi.hoisted(() => ({
  getSSHHosts: vi.fn(),
  listPersistentSessions: vi.fn(),
  createPersistentSession: vi.fn(),
  killPersistentSession: vi.fn(),
  patchPersistentSession: vi.fn(),
  useOptionalServerStatus: vi.fn(),
  refreshStatuses: vi.fn(),
}));

vi.mock("@/main-axios", () => ({ getSSHHosts: mocks.getSSHHosts }));
vi.mock("@/api/persistent-sessions-api", () => ({
  listPersistentSessions: mocks.listPersistentSessions,
  createPersistentSession: mocks.createPersistentSession,
  killPersistentSession: mocks.killPersistentSession,
  patchPersistentSession: mocks.patchPersistentSession,
}));
vi.mock("@/lib/ServerStatusContext", () => ({
  useOptionalServerStatus: mocks.useOptionalServerStatus,
}));

function host(id: number, name: string): SSHHostWithStatus {
  return {
    id,
    name,
    ip: `192.168.15.${id}`,
    port: 22,
    username: "admin",
    authType: "key",
    status: "offline",
  } as SSHHostWithStatus;
}

function persistentSession(
  overrides: Partial<PersistentSession> = {},
): PersistentSession {
  return {
    id: "session-1",
    hostId: 1,
    displayName: "codex",
    tmuxSessionName: "codex",
    managementState: "managed",
    expiryMode: "manual",
    expirySeconds: null,
    createdAt: "2026-08-31T12:00:00.000Z",
    lastAttachedAt: null,
    lastDetachedAt: null,
    expiresAt: null,
    lastObservedAt: null,
    hibernatedAt: null,
    endedAt: null,
    endReason: null,
    ...overrides,
  };
}

function useStatuses(
  entries: Array<[number, "online" | "reachable" | "offline" | "degraded"]>,
  initialLoadComplete = true,
) {
  const statuses = new Map(
    entries.map(([id, status]) => [
      id,
      { status, lastChecked: new Date().toISOString() },
    ]),
  );
  mocks.useOptionalServerStatus.mockReturnValue({
    statuses,
    isLoading: !initialLoadComplete,
    initialLoadComplete,
    refreshStatuses: mocks.refreshStatuses,
    getStatus: (id: number) => statuses.get(id)?.status ?? "offline",
  });
}

describe("SessionsPanel host availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshStatuses.mockResolvedValue(undefined);
    mocks.getSSHHosts.mockResolvedValue([host(1, "Devhub"), host(3, "Old")]);
    mocks.listPersistentSessions.mockResolvedValue({ data: [], total: 0 });
  });

  it("hides hosts while their status is still being checked", async () => {
    useStatuses([], false);

    render(<SessionsPanel onAttach={vi.fn()} />);

    expect(
      await screen.findByRole("option", { name: "No online hosts available" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Devhub/i })).toBeNull();
  });

  it("shows only hosts confirmed as online", async () => {
    useStatuses([
      [1, "online"],
      [3, "offline"],
    ]);

    render(<SessionsPanel onAttach={vi.fn()} />);

    expect(
      await screen.findByRole("option", { name: "Devhub (default)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Old/i })).toBeNull();
    expect(screen.queryByText(/checking|offline/i)).toBeNull();
  });

  it("pre-selects the devhub default host once it is online", async () => {
    useStatuses([[1, "online"]]);

    render(<SessionsPanel onAttach={vi.fn()} />);

    const select = await screen.findByLabelText("Host");
    await waitFor(() => expect(select).toHaveValue("1"));
  });

  it("does not pre-select anything when the default host is offline", async () => {
    useStatuses([[1, "offline"]]);

    render(<SessionsPanel onAttach={vi.fn()} />);

    const select = await screen.findByLabelText("Host");
    expect(select).toHaveValue("");
  });

  it("labels only the devhub host as default", async () => {
    mocks.getSSHHosts.mockResolvedValue([host(1, "Devhub"), host(4, "Other")]);
    useStatuses([
      [1, "online"],
      [4, "online"],
    ]);

    render(<SessionsPanel onAttach={vi.fn()} />);

    expect(
      await screen.findByRole("option", { name: "Devhub (default)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument();
  });

  it("clears a selected host when it is no longer online", async () => {
    const user = userEvent.setup();
    useStatuses([[1, "online"]]);
    const { rerender } = render(<SessionsPanel onAttach={vi.fn()} />);

    const select = await screen.findByLabelText("Host");
    await user.selectOptions(select, "1");
    expect(select).toHaveValue("1");

    useStatuses([[1, "offline"]]);
    rerender(<SessionsPanel onAttach={vi.fn()} />);

    await waitFor(() => expect(select).toHaveValue(""));
    expect(screen.queryByRole("option", { name: "Devhub" })).toBeNull();
  });

  it("opens a newly created session immediately", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const created = persistentSession();
    mocks.createPersistentSession.mockResolvedValue(created);
    useStatuses([[1, "online"]]);

    render(<SessionsPanel onAttach={onAttach} />);

    await user.selectOptions(await screen.findByLabelText("Host"), "1");
    await user.type(screen.getByLabelText("Name"), "codex");
    await user.click(screen.getByRole("button", { name: /create session/i }));

    await waitFor(() =>
      expect(onAttach).toHaveBeenCalledWith(
        created,
        expect.objectContaining({ id: "1", name: "Devhub" }),
      ),
    );
  });

  it("notifies the shell after a session is terminated", async () => {
    const user = userEvent.setup();
    const onTerminate = vi.fn();
    const session = persistentSession();
    mocks.listPersistentSessions.mockResolvedValue({
      data: [session],
      total: 1,
    });
    mocks.killPersistentSession.mockResolvedValue({
      ...session,
      endedAt: "2026-08-31T12:01:00.000Z",
      endReason: "terminated",
    });
    useStatuses([[1, "online"]]);

    render(<SessionsPanel onAttach={vi.fn()} onTerminate={onTerminate} />);

    await user.click(await screen.findByTitle("Terminate remote session"));
    expect(
      await screen.findByRole("dialog", { name: "Terminate session?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Terminate" }));

    await waitFor(() => expect(onTerminate).toHaveBeenCalledWith(session));
  });

  it("marks hibernated sessions as standby instead of a running clock", async () => {
    const session = persistentSession({
      hibernatedAt: "2026-08-31T09:00:00.000Z",
    });
    mocks.listPersistentSessions.mockResolvedValue({
      data: [session],
      total: 1,
    });
    useStatuses([[1, "online"]]);

    render(<SessionsPanel onAttach={vi.fn()} />);

    expect(await screen.findByText(/standby · frozen/)).toBeInTheDocument();
    expect(screen.queryByText(/running · up/)).toBeNull();
  });

  it("offers force removal when the terminate fails on an unreachable host", async () => {
    const user = userEvent.setup();
    const onTerminate = vi.fn();
    const session = persistentSession();
    mocks.listPersistentSessions.mockResolvedValue({
      data: [session],
      total: 1,
    });
    mocks.killPersistentSession
      .mockRejectedValueOnce(new Error("Remote host is unavailable"))
      .mockResolvedValueOnce({
        ...session,
        endedAt: "2026-08-31T12:01:00.000Z",
        endReason: "killed-unreachable",
      });
    useStatuses([[1, "online"]]);

    render(<SessionsPanel onAttach={vi.fn()} onTerminate={onTerminate} />);

    await user.click(await screen.findByTitle("Terminate remote session"));
    await user.click(await screen.findByRole("button", { name: "Terminate" }));

    const force = await screen.findByRole("button", { name: "Force remove" });
    expect(screen.getByText("Remote host is unavailable")).toBeInTheDocument();
    await user.click(force);

    await waitFor(() =>
      expect(mocks.killPersistentSession).toHaveBeenCalledWith("session-1", {
        force: true,
      }),
    );
    await waitFor(() => expect(onTerminate).toHaveBeenCalledWith(session));
  });

  it("offers force removal when a 409 conflict blocks the terminate", async () => {
    // A tmux server restart wipes every session marker; the guarded
    // terminate then fails with a generic 409 and force is the only way
    // out. The button must appear for conflicts, not just dead hosts.
    const user = userEvent.setup();
    const session = persistentSession();
    mocks.listPersistentSessions.mockResolvedValue({
      data: [session],
      total: 1,
    });
    mocks.killPersistentSession
      .mockRejectedValueOnce(
        new Error("Conflict. The resource already exists or is in use."),
      )
      .mockResolvedValueOnce({
        ...session,
        endedAt: "2026-08-31T12:01:00.000Z",
        endReason: "killed",
      });
    useStatuses([[1, "online"]]);

    render(<SessionsPanel onAttach={vi.fn()} />);

    await user.click(await screen.findByTitle("Terminate remote session"));
    await user.click(await screen.findByRole("button", { name: "Terminate" }));

    expect(
      await screen.findByRole("button", { name: "Force remove" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Conflict. The resource already exists or is in use."),
    ).toBeInTheDocument();
  });

  it("attaches in split view when the split button is clicked", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const onAttachSplit = vi.fn();
    const session = persistentSession();
    mocks.listPersistentSessions.mockResolvedValue({
      data: [session],
      total: 1,
    });
    useStatuses([[1, "online"]]);

    render(<SessionsPanel onAttach={onAttach} onAttachSplit={onAttachSplit} />);

    await user.click(await screen.findByRole("button", { name: /split/i }));

    await waitFor(() =>
      expect(onAttachSplit).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ id: "1", name: "Devhub" }),
      ),
    );
    expect(onAttach).not.toHaveBeenCalled();
  });

  it("hides the split button when the shell does not support split view", async () => {
    mocks.listPersistentSessions.mockResolvedValue({
      data: [persistentSession()],
      total: 1,
    });
    useStatuses([[1, "online"]]);

    render(<SessionsPanel onAttach={vi.fn()} />);

    await screen.findByRole("button", { name: /attach/i });
    expect(screen.queryByRole("button", { name: /split/i })).toBeNull();
  });
});
