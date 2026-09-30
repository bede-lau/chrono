/**
 * Sphere <-> equirectangular helpers. Pure, isomorphic (Node + browser), no dependencies. OWNER: mask agent (round 2).
 *
 * THE convention (docs/ROUND2.md section 2, `Wound` in chain/types.ts, `dirToUv` in organism/shaders.ts):
 *
 *   u = longitude 0..1, wraps          (u = 0 and u = 1 are the same meridian, the image seam)
 *   v = latitude,  v = 1 NORTH pole = TOP image row,  v = 0 SOUTH pole = BOTTOM image row
 *
 *   phi   = 2 pi u                      longitude
 *   theta = pi (1 - v)                  polar angle measured from +Y (north)
 *   d     = ( -sin(theta) cos(phi),  cos(theta),  sin(theta) sin(phi) )        unit vector, +Y = north
 *
 *   inverse (identical to the shader):  u = fract( atan2(d.z, -d.x) / 2 pi ),   v = 1 - acos(d.y) / pi
 *
 * The centre of pixel (px, py) of a W x H equirectangular image sits at
 *   u = (px + 0.5) / W,   v = 1 - (py + 0.5) / H          i.e.  py = (1 - v) * H - 0.5.
 *
 * Note: `dirToUv` below uses atan2(hypot(x, z), y) for the polar angle instead of the shader's acos(y). They are the
 * same function, but atan2 stays accurate near the poles where acos(y) loses precision.
 */

export type Vec3 = [number, number, number];

const TAU = Math.PI * 2;

/** Image/wound space (u, v) -> unit direction on the sphere. u wraps; v is clamped to 0..1. */
export function uvToDir(u: number, v: number): Vec3 {
  const phi = u * TAU;
  const vv = v < 0 ? 0 : v > 1 ? 1 : v;
  const theta = (1 - vv) * Math.PI;
  const s = Math.sin(theta);
  return [-s * Math.cos(phi), Math.cos(theta), s * Math.sin(phi)];
}

/**
 * Direction (need not be unit length) -> image/wound space (u, v). Exact inverse of `uvToDir`. At the poles u is
 * undefined and returns 0. A zero-length input maps to the equator at u = 0.
 */
export function dirToUv(d: Vec3 | { x: number; y: number; z: number }): { u: number; v: number } {
  const [x, y, z] = Array.isArray(d) ? d : [d.x, d.y, d.z];
  const rho = Math.hypot(x, z);
  if (rho === 0 && y === 0) return { u: 0, v: 0.5 };
  const theta = Math.atan2(rho, y); // 0 at north .. pi at south, well conditioned everywhere
  let u = rho === 0 ? 0 : Math.atan2(z, -x) / TAU;
  u = ((u % 1) + 1) % 1;
  return { u, v: 1 - theta / Math.PI };
}

/**
 * Great-circle angle (radians, 0..pi) between two unit vectors. atan2(|a x b|, a . b) is accurate for both nearly
 * parallel and nearly antipodal vectors, where acos(a . b) loses half its digits.
 */
export function angleBetween(a: Vec3, b: Vec3): number {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}
