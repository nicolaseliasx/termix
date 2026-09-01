export interface TerminalOverviewRulerOptions {
  width?: number;
}

export function getTerminalOverviewRulerOptions(
  isMobile: boolean,
): TerminalOverviewRulerOptions {
  return isMobile ? { width: 1 } : {};
}
