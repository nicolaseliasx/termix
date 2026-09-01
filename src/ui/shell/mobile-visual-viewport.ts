export interface MobileVisualViewportMetrics {
  height: number;
  offsetTop: number;
}

export interface MobileVisualViewportCssValues {
  height: string;
}

export function getMobileVisualViewportCssValues(
  viewport: MobileVisualViewportMetrics,
): MobileVisualViewportCssValues {
  const offsetTop = Math.max(0, Math.round(viewport.offsetTop));
  const height = Math.max(1, Math.round(viewport.height) + offsetTop);

  return {
    height: `${height}px`,
  };
}
