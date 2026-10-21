/**
 * The mountain as pure math. Both the rendered chunk meshes and all physics
 * sample these functions, so what you see is what you collide with.
 *
 * Downhill is the -Z direction. Height drops by SLOPE per metre travelled.
 */
import { noise2 } from './noise';
import { clamp, hash1, smoothstep, snap } from '../core/math';

export const SLOPE = 0.3;
export const PATH_HALF = 26;
export const CHUNK_LEN = 80;
export const CHUNK_HALF_W = 190;
export const CELL_X = 5;
export const CELL_Z = 2.5;

/** Centre line of the skiable valley; it meanders left and right. */
export function pathX(z: number): number {
  return 48 * Math.sin(z * 0.0019) + 20 * Math.sin(z * 0.0051 + 1.3);
}

/** Height of the snow without jump gaps or ramps. */
export function rawHeight(x: number, z: number): number {
  const d = Math.abs(x - pathX(z));
  const e = Math.max(0, d - PATH_HALF);
  const bank = 50 * (1 - Math.exp((-e * e) / 3000)) + e * 0.18;
  const wild = smoothstep(PATH_HALF - 8, PATH_HALF + 18, d);
  const n1 = noise2(x * 0.021, z * 0.021);
  const n2 = noise2(x * 0.075 + 31.7, z * 0.075 - 11.3);
  const n3 = noise2(x * 0.009 - 7.1, z * 0.009 + 3.3);
  return z * SLOPE + bank + n1 * (1.1 + wild * 2.6) + n2 * (0.2 + wild * 0.45) + n3 * wild * 8;
}

// ---------------------------------------------------------------------------
// Jump features: a snow kicker ramp followed (usually) by a crevasse gap.
// ---------------------------------------------------------------------------

export interface JumpFeature {
  rampX: number;
  /** Uphill (entry) edge of the ramp. The ramp extends toward -Z. */
  rampZ: number;
  rampLen: number;
  rampW: number;
  rampH: number;
  rampBaseY: number;
  hasGap: boolean;
  gapX: number;
  gapHalfW: number;
  /** Uphill edge of the gap (larger z). */
  gapStart: number;
  gapEnd: number;
}

export const FEATURE_SPACING = 200;
const GAP_DEPTH = 10;
const featureCache = new Map<number, JumpFeature | null>();

export function featureForSegment(k: number): JumpFeature | null {
  if (k < 2) return null;
  const cached = featureCache.get(k);
  if (cached !== undefined) return cached;

  let f: JumpFeature | null = null;
  if (hash1(k * 3.17 + 1) < 0.68) {
    const rampZ = snap(-(k * FEATURE_SPACING + 50 + hash1(k * 7.31 + 2) * 60), CELL_Z);
    const rampX = snap(pathX(rampZ) + (hash1(k * 1.91 + 3) - 0.5) * 18, CELL_X);
    const rampLen = 9;
    const gapStart = snap(rampZ - rampLen - 12, CELL_Z);
    f = {
      rampX,
      rampZ,
      rampLen,
      rampW: 12,
      rampH: 2.7,
      rampBaseY: rawHeight(rampX, rampZ) - 0.25,
      hasGap: hash1(k * 5.53 + 4) < 0.75,
      gapX: rampX,
      gapHalfW: 10,
      gapStart,
      gapEnd: gapStart - 10,
    };
  }
  featureCache.set(k, f);
  return f;
}

export function featureAt(z: number): JumpFeature | null {
  return featureForSegment(Math.floor(-z / FEATURE_SPACING));
}

export function resetFeatureCache(): void {
  featureCache.clear();
}

/**
 * Depth of a crevasse at (x, z). The mask ramps linearly across exactly one
 * mesh cell so the physics matches the rendered triangles.
 */
export function gapDepth(x: number, z: number): number {
  const f = featureAt(z);
  if (!f || !f.hasGap) return 0;
  const mz = clamp((f.gapStart - z) / CELL_Z, 0, 1) * clamp((z - f.gapEnd) / CELL_Z, 0, 1);
  if (mz <= 0) return 0;
  const mx = clamp((f.gapHalfW - Math.abs(x - f.gapX)) / CELL_X, 0, 1);
  return GAP_DEPTH * mz * mx;
}

export const rampProfile = (u: number): number => 0.5 * u + 0.5 * u * u;

/** Height of a ramp's top surface at (x, z), or -Infinity if not on a ramp. */
export function rampSurface(x: number, z: number): number {
  const f = featureAt(z);
  if (!f) return -Infinity;
  const u = (f.rampZ - z) / f.rampLen;
  if (u < 0 || u > 1 || Math.abs(x - f.rampX) > f.rampW / 2) return -Infinity;
  return f.rampBaseY - SLOPE * (f.rampZ - z) + f.rampH * rampProfile(u);
}

/** Terrain mesh height (includes gaps, excludes ramps). */
export function terrainHeight(x: number, z: number): number {
  return rawHeight(x, z) - gapDepth(x, z);
}

/** Height a skier stands on: terrain plus ramps. */
export function groundHeight(x: number, z: number): number {
  return Math.max(terrainHeight(x, z), rampSurface(x, z));
}
