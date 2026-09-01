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
      await screen.findByRole("option", { name: "Devhub" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Old/i })).toBeNull();
    expect(screen.queryByText(/checking|offline/i)).toBeNull();
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
        expect.objectContaining({ id: 1, name: "Devhub" }),
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
});
