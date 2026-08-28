import type { PersistentSessionRole } from "./types.js";

export class PersistentSessionRegistry {
  private readonly sessions = new Map<
    string,
    Map<string, PersistentSessionRole>
  >();

  attach(
    sessionId: string,
    clientId: string,
    role: PersistentSessionRole,
  ): PersistentSessionRole {
    const participants =
      this.sessions.get(sessionId) ?? new Map<string, PersistentSessionRole>();
    const writer = [...participants.entries()].find(
      ([, value]) => value === "writer",
    );
    if (role === "writer" && writer && writer[0] !== clientId)
      throw new Error("PERSISTENT_SESSION_WRITER_CONFLICT");
    participants.set(clientId, role);
    this.sessions.set(sessionId, participants);
    return role;
  }

  detach(sessionId: string, clientId: string): void {
    const participants = this.sessions.get(sessionId);
    if (!participants) return;
    participants.delete(clientId);
    if (participants.size === 0) this.sessions.delete(sessionId);
  }

  takeControl(sessionId: string, clientId: string): string | undefined {
    const participants = this.sessions.get(sessionId);
    if (!participants?.has(clientId))
      throw new Error("PERSISTENT_SESSION_NOT_ATTACHED");
    const oldWriter = [...participants.entries()].find(
      ([, role]) => role === "writer",
    )?.[0];
    if (oldWriter && oldWriter !== clientId)
      participants.set(oldWriter, "viewer");
    participants.set(clientId, "writer");
    return oldWriter === clientId ? undefined : oldWriter;
  }

  canWrite(sessionId: string, clientId: string): boolean {
    return this.sessions.get(sessionId)?.get(clientId) === "writer";
  }
  participantCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.size ?? 0;
  }
  writerClientId(sessionId: string): string | undefined {
    return [...(this.sessions.get(sessionId)?.entries() ?? [])].find(
      ([, role]) => role === "writer",
    )?.[0];
  }
}
