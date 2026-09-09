import { describe, expect, it } from "vitest";
import {
  buildImageUploadFormData,
  getPastedImageFile,
} from "@/features/terminal/terminal-image-upload";

describe("buildImageUploadFormData", () => {
  it("tags a picked-file upload with source=file and a client timestamp", () => {
    const file = new File(["png-bytes"], "photo.png", { type: "image/png" });

    const form = buildImageUploadFormData(file, "tab-1", "file");

    expect(form.get("image")).toBe(file);
    expect(form.get("instanceId")).toBe("tab-1");
    expect(form.get("source")).toBe("file");
    const timestamp = form.get("clientUploadTimestamp");
    expect(typeof timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(timestamp as string))).toBe(false);
  });

  it("tags a clipboard upload with source=clipboard", () => {
    const file = new File(["png-bytes"], "clipboard-image.png", {
      type: "image/png",
    });

    const form = buildImageUploadFormData(file, "tab-1", "clipboard");

    expect(form.get("source")).toBe("clipboard");
  });

  it("uses the caller-provided client timestamp unchanged", () => {
    const file = new File(["png-bytes"], "photo.png", { type: "image/png" });

    const form = buildImageUploadFormData(
      file,
      "tab-1",
      "file",
      "2026-08-15T12:00:00.000Z",
    );

    expect(form.get("clientUploadTimestamp")).toBe("2026-08-15T12:00:00.000Z");
  });

  it("includes the stable host ID when one is available", () => {
    const file = new File(["png-bytes"], "photo.png", { type: "image/png" });

    const form = buildImageUploadFormData(
      file,
      "tab-1",
      "clipboard",
      "2026-08-15T12:00:00.000Z",
      42,
    );

    expect(form.get("hostId")).toBe("42");
  });
});

describe("getPastedImageFile", () => {
  it("returns an image from clipboard items before regular files", () => {
    const pastedImage = new File(["png-bytes"], "pasted.png", {
      type: "image/png",
    });
    const fallbackImage = new File(["jpeg-bytes"], "fallback.jpg", {
      type: "image/jpeg",
    });
    const clipboardData = {
      items: [
        {
          kind: "string",
          type: "text/plain",
          getAsFile: () => null,
        },
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => pastedImage,
        },
      ],
      files: [fallbackImage],
    } as unknown as Pick<DataTransfer, "files" | "items">;

    expect(getPastedImageFile(clipboardData)).toBe(pastedImage);
  });

  it("falls back to clipboard files when items do not expose the image", () => {
    const pastedImage = new File(["png-bytes"], "pasted.png", {
      type: "image/png",
    });
    const clipboardData = {
      items: [],
      files: [
        new File(["text"], "note.txt", { type: "text/plain" }),
        pastedImage,
      ],
    } as unknown as Pick<DataTransfer, "files" | "items">;

    expect(getPastedImageFile(clipboardData)).toBe(pastedImage);
  });

  it("ignores text-only clipboard content", () => {
    const clipboardData = {
      items: [
        {
          kind: "string",
          type: "text/plain",
          getAsFile: () => null,
        },
      ],
      files: [],
    } as unknown as Pick<DataTransfer, "files" | "items">;

    expect(getPastedImageFile(clipboardData)).toBeNull();
  });
});
