export type TerminalImageUploadSource = "file" | "clipboard";

/**
 * Returns the first image file supplied by a browser paste event.
 *
 * Clipboard implementations do not consistently populate both `items` and
 * `files`, so inspect the richer item list first and retain `files` as a
 * fallback. This keeps regular text pastes out of the image-upload path.
 */
export function getPastedImageFile(
  clipboardData: Pick<DataTransfer, "files" | "items">,
): File | null {
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }

  return (
    Array.from(clipboardData.files).find((file) =>
      file.type.startsWith("image/"),
    ) ?? null
  );
}

export function buildImageUploadFormData(
  file: File,
  instanceId: string,
  source: TerminalImageUploadSource,
  clientUploadTimestamp = new Date().toISOString(),
  hostId?: string | number,
): FormData {
  const form = new FormData();
  form.append("image", file);
  form.append("instanceId", instanceId);
  form.append("source", source);
  form.append("clientUploadTimestamp", clientUploadTimestamp);
  if (hostId !== undefined) form.append("hostId", String(hostId));
  return form;
}
