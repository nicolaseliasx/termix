import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AiPanel } from "../../../features/ai/AiPanel";

const sendMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/main-axios", () => ({
  saveUserPreferences: vi.fn(async () => {}),
}));

vi.mock("@/api/ai-api", () => ({
  getAiStatus: vi.fn(async () => ({
    globallyEnabled: true,
    enabled: true,
    allowReadOnlyCommands: false,
  })),
  getAiProviders: vi.fn(async () => [
    {
      id: 1,
      providerType: "ollama",
      label: "local",
      baseUrl: "http://localhost:11434",
      apiKeyPrefix: null,
      defaultModel: null,
      enabled: true,
      createdAt: "2026-08-28T00:00:00.000Z",
    },
  ]),
  getAiConversation: vi.fn(async () => ({
    conversation: {
      id: 1,
      title: null,
      providerId: 1,
      model: null,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    },
    messages: [],
    proposals: [],
  })),
}));

vi.mock("../../../features/ai/use-ai-stream", () => ({
  useAiStream: () => ({
    state: {
      streaming: false,
      assistantText: "",
      tools: [],
      proposals: [],
      conversationId: null,
    },
    send: sendMock,
    stop: vi.fn(),
  }),
}));

vi.mock("../../../features/ai/useMentions", () => ({
  useMentions: () => ({ search: () => [] }),
  activeMentionQuery: () => null,
}));

async function textarea(): Promise<HTMLTextAreaElement> {
  render(<AiPanel />);
  await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

describe("AiPanel prompt textarea keys", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const input = await textarea();
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("hello\n");
    // The caret lands after the inserted newline.
    expect((input as HTMLTextAreaElement).selectionStart).toBe(6);
  });

  it("sends on plain Enter", async () => {
    const input = await textarea();
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect((input as HTMLTextAreaElement).value).toBe("");
  });
});
