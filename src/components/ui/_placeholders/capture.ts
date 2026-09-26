/** TEMPORARY stand-in for src/components/organism/capture.ts (viewport agent). */
export async function captureOrganismPng(): Promise<Blob | null> {
  const canvas = document.querySelector("canvas");
  if (!canvas) return null;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
