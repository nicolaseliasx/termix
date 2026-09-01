export interface TerminalDimensions {
  cols: number;
  rows: number;
}

function isValidDimensions(
  size: TerminalDimensions | null | undefined,
): size is TerminalDimensions {
  return !!size && size.cols > 0 && size.rows > 0;
}

function sameDimensions(
  left: TerminalDimensions | null,
  right: TerminalDimensions | null,
): boolean {
  return (
    !!left && !!right && left.cols === right.cols && left.rows === right.rows
  );
}

export class TerminalResizeCoordinator {
  private initialSize: TerminalDimensions | null = null;
  private latestSize: TerminalDimensions | null = null;
  private lastTakenSize: TerminalDimensions | null = null;
  private remoteReady = false;

  beginConnection(initialSize: TerminalDimensions): void {
    this.initialSize = isValidDimensions(initialSize)
      ? { ...initialSize }
      : null;
    this.latestSize = null;
    this.lastTakenSize = null;
    this.remoteReady = false;
  }

  record(size: TerminalDimensions): void {
    if (isValidDimensions(size)) {
      this.latestSize = { ...size };
    }
  }

  markRemoteReady(): void {
    this.remoteReady = true;
  }

  takePendingResize(): TerminalDimensions | null {
    if (!this.remoteReady || !isValidDimensions(this.latestSize)) return null;
    if (sameDimensions(this.latestSize, this.initialSize)) return null;
    if (sameDimensions(this.latestSize, this.lastTakenSize)) return null;

    this.lastTakenSize = { ...this.latestSize };
    return { ...this.latestSize };
  }

  reset(): void {
    this.initialSize = null;
    this.latestSize = null;
    this.lastTakenSize = null;
    this.remoteReady = false;
  }
}
