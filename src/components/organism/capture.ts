/**
 * Capture the organism viewport as a PNG. OWNER: viewport agent.
 * The Canvas is created with preserveDrawingBuffer, so the last composited frame can be read at any time.
 */

let current: HTMLCanvasElement | null = null;

/** Called by the organism scene when its WebGL canvas is created / destroyed. */
export function registerOrganismCanvas(canvas: HTMLCanvasElement | null) {
  current = canvas;
}

export function unregisterOrganismCanvas(canvas: HTMLCanvasElement) {
  if (current === canvas) current = null;
}

/** PNG data URL of the current organism frame, or null when no organism canvas is mounted. */
export function captureOrganismPng(): string | null {
  if (!current || !current.isConnected) return null;
  try {
    return current.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Blob variant (better for downloads of large frames). */
export function captureOrganismBlob(): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!current || !current.isConnected) return resolve(null);
    try {
      current.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
}
