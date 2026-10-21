import * as THREE from 'three';
import { clamp, mulberry32, randRange } from '../core/math';
import { noise2 } from './noise';
import {
  CELL_X,
  CELL_Z,
  CHUNK_HALF_W,
  CHUNK_LEN,
  FEATURE_SPACING,
  PATH_HALF,
  SLOPE,
  featureForSegment,
  gapDepth,
  pathX,
  rawHeight,
  type JumpFeature,
} from './terrain';
import { geos, mats } from './props';

export type ObstacleKind = 'tree' | 'rock' | 'snowman' | 'log' | 'drift';
export type PickupKind = 'coin' | 'medkit' | 'syringe';

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  z: number;
  /** Ground height at the base. */
  y: number;
  /** Collision radius in the XZ plane. */
  r: number;
  /** Height above base; anything above this clears the obstacle. */
  h: number;
  /** Half-length along X for logs (capsule collider). */
  halfLen: number;
  mesh: THREE.Mesh;
  alive: boolean;
  /** The doctor already crashed into this one; it never counts again. */
  struck: boolean;
  shake: number;
  cooldown: number;
}

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  mesh: THREE.Mesh;
  taken: boolean;
  phase: number;
}

const NX = Math.round((CHUNK_HALF_W * 2) / CELL_X);
const NZ = Math.round(CHUNK_LEN / CELL_Z);

const SNOW_HI = new THREE.Color(0xffffff);
const SNOW_LO = new THREE.Color(0xdde9f8);
const SNOW_SHADE = new THREE.Color(0xc4d7f0);
const ICE = new THREE.Color(0x3f78b8);
const ROCKY = new THREE.Color(0x8a96aa);
const GROOMED = new THREE.Color(0xf3f8ff);

let sharedIndex: THREE.BufferAttribute | null = null;
function gridIndex(): THREE.BufferAttribute {
  if (sharedIndex) return sharedIndex;
  const idx: number[] = [];
  const row = NX + 1;
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      // Counter-clockwise seen from above so the snow faces up. Alternate the
      // diagonal for a less regular low-poly look.
      if ((ix + iz) % 2 === 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, d, c, a, b, d);
    }
  }
  sharedIndex = new THREE.BufferAttribute(new Uint32Array(idx), 1);
  return sharedIndex;
}

export class Chunk {
  index = Number.NaN;
  readonly mesh: THREE.Mesh;
  readonly props = new THREE.Group();
  obstacles: Obstacle[] = [];
  pickups: Pickup[] = [];
  private readonly geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.BufferGeometry();
    const count = (NX + 1) * (NZ + 1);
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.geo.setIndex(gridIndex());
    this.mesh = new THREE.Mesh(this.geo, mats.terrain);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh, this.props);
  }

  get zStart(): number {
    return -this.index * CHUNK_LEN;
  }

  build(index: number): void {
    this.index = index;
    this.buildTerrain();
    this.buildProps();
  }

  private buildTerrain(): void {
    const z0 = this.zStart;
    const baseY = z0 * SLOPE;
    this.mesh.position.set(0, baseY, z0);
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const col = this.geo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    let i = 0;
    for (let iz = 0; iz <= NZ; iz++) {
      const lz = -iz * CELL_Z;
      const z = z0 + lz;
      const px = pathX(z);
      for (let ix = 0; ix <= NX; ix++) {
        const x = -CHUNK_HALF_W + ix * CELL_X;
        const gap = gapDepth(x, z);
        const h = rawHeight(x, z) - gap;
        pos.setXYZ(i, x, h - baseY, lz);

        const d = Math.abs(x - px);
        const n = noise2(x * 0.11, z * 0.11) * 0.5 + 0.5;
        c.lerpColors(SNOW_LO, SNOW_HI, n);
        if (d < PATH_HALF - 2) c.lerp(GROOMED, 0.5);
        const bankT = clamp((d - PATH_HALF) / 50, 0, 1);
        c.lerp(SNOW_SHADE, bankT * 0.55);
        if (d > PATH_HALF + 45 && noise2(x * 0.05 + 9, z * 0.05) > 0.35) c.lerp(ROCKY, 0.75);
        if (gap > 0) c.lerp(ICE, clamp(gap / 6, 0, 1));
        col.setXYZ(i, c.r, c.g, c.b);
        i++;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.geo.computeBoundingBox();
  }

  private clearProps(): void {
    this.props.clear();
    this.obstacles = [];
    this.pickups = [];
  }

  private addMesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    scale = 1,
    rotY = 0,
    shadow = true,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(scale);
    m.rotation.y = rotY;
    m.castShadow = shadow;
    m.receiveShadow = false;
    m.matrixAutoUpdate = true;
    this.props.add(m);
    return m;
  }

  private addObstacle(kind: ObstacleKind, x: number, z: number, scale: number, rng: () => number, shadow = true): void {
    const y = rawHeight(x, z);
    let geo: THREE.BufferGeometry;
    let r = 1;
    let h = 2;
    let halfLen = 0;
    let rotY = rng() * Math.PI * 2;
    switch (kind) {
      case 'tree':
        geo = geos.trees[Math.floor(rng() * geos.trees.length)];
        r = 0.9 * scale;
        h = 6 * scale;
        break;
      case 'rock':
        geo = geos.rocks[Math.floor(rng() * geos.rocks.length)];
        r = 1.15 * scale;
        h = 1.25 * scale;
        break;
      case 'snowman':
        geo = geos.snowman;
        r = 0.85 * scale;
        h = 3.3 * scale;
        rotY = (rng() - 0.5) * 0.8;
        break;
      case 'log':
        geo = geos.log;
        r = 0.55 * scale;
        h = 1.0 * scale;
        halfLen = 3.1 * scale;
        rotY = 0;
        break;
      case 'drift':
        geo = geos.drift;
        r = 2.4 * scale;
        h = 0.7 * scale;
        rotY = (rng() - 0.5) * 0.6;
        break;
    }
    const mesh = this.addMesh(geo, mats.prop, x, y - 0.15, z, scale, rotY, shadow);
    if (kind === 'drift') mesh.receiveShadow = true;
    this.obstacles.push({ kind, x, z, y, r, h, halfLen, mesh, alive: true, struck: false, shake: 0, cooldown: 0 });
  }

  private addPickup(kind: PickupKind, x: number, y: number, z: number): void {
    const geo = kind === 'coin' ? geos.coin : kind === 'medkit' ? geos.medkit : geos.syringe;
    const mat = kind === 'coin' ? mats.coin : mats.pickup;
    const mesh = this.addMesh(geo, mat, x, y, z, kind === 'coin' ? 1 : 1.1, 0, true);
    if (kind === 'syringe') mesh.rotation.z = 0.6;
    this.pickups.push({ kind, x, y, z, mesh, taken: false, phase: Math.random() * 6 });
  }

  private featureInChunk(): JumpFeature | null {
    const z0 = this.zStart;
    const k0 = Math.floor(-z0 / FEATURE_SPACING);
    const k1 = Math.floor(-(z0 - CHUNK_LEN) / FEATURE_SPACING);
    for (let k = k0; k <= k1; k++) {
      const f = featureForSegment(k);
      if (f && f.rampZ <= z0 && f.rampZ > z0 - CHUNK_LEN) return f;
    }
    return null;
  }

  private buildProps(): void {
    this.clearProps();
    const index = this.index;
    const z0 = this.zStart;
    const rng = mulberry32(index * 9973 + 1337);
    const density = clamp(index / 45, 0, 1);

    // Forest on the valley walls.
    for (let i = 0; i < 38; i++) {
      const z = z0 - rng() * CHUNK_LEN;
      const side = rng() < 0.5 ? -1 : 1;
      const d = PATH_HALF - 1 + Math.pow(rng(), 1.5) * 135;
      const x = pathX(z) + side * d;
      if (Math.abs(x) > CHUNK_HALF_W - 4) continue;
      this.addObstacle('tree', x, z, randRange(rng, 0.85, 1.5), rng, d < 70);
    }

    // Boulder clusters on the banks.
    for (let i = 0; i < 3; i++) {
      const z = z0 - rng() * CHUNK_LEN;
      const side = rng() < 0.5 ? -1 : 1;
      const x = pathX(z) + side * (PATH_HALF + 5 + rng() * 45);
      this.addObstacle('rock', x, z, randRange(rng, 2.5, 5.5), rng);
    }

    // Course marker poles every 20 m give a strong sense of speed.
    for (let mz = 0; mz < CHUNK_LEN; mz += 20) {
      const z = z0 - mz;
      for (const side of [-1, 1]) {
        const x = pathX(z) + side * (PATH_HALF - 1.5);
        this.addMesh(geos.marker, mats.prop, x, rawHeight(x, z) - 0.1, z, 1, 0, true);
      }
    }

    const feature = this.featureInChunk();
    const nearFeature = (x: number, z: number): boolean => {
      if (!feature) return false;
      return z < feature.rampZ + 14 && z > feature.gapEnd - 10 && Math.abs(x - feature.rampX) < feature.gapHalfW + 4;
    };

    if (feature) this.buildFeature(feature);

    // Hazards on the piste. The first chunks are left clear for a clean start.
    const placed: [number, number][] = [];
    if (index >= 1) {
      const count = Math.floor(2 + density * 10 + rng() * 2);
      for (let i = 0, tries = 0; i < count && tries < count * 6; tries++) {
        const z = z0 - rng() * CHUNK_LEN;
        const x = pathX(z) + (rng() * 2 - 1) * (PATH_HALF - 3);
        if (nearFeature(x, z) || placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 6)) continue;
        const roll = rng();
        let kind: ObstacleKind;
        if (roll < 0.38) kind = 'tree';
        else if (roll < 0.6) kind = 'rock';
        else if (roll < 0.74) kind = 'snowman';
        else if (roll < 0.86) kind = 'log';
        else kind = 'drift';
        const scale = kind === 'rock' ? randRange(rng, 0.7, 1.6) : kind === 'tree' ? randRange(rng, 0.85, 1.25) : 1;
        this.addObstacle(kind, x, z, scale, rng);
        placed.push([x, z]);
        i++;
      }
    }

    // Coin trails that snake down the piste.
    if (index >= 1 && rng() < 0.6) {
      const startZ = z0 - rng() * (CHUNK_LEN - 40);
      const offset = (rng() * 2 - 1) * (PATH_HALF - 8);
      const wiggle = rng() * 6;
      for (let i = 0; i < 10; i++) {
        const z = startZ - i * 4;
        const x = pathX(z) + offset + Math.sin(i * 0.6) * wiggle;
        if (nearFeature(x, z) || placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3)) continue;
        this.addPickup('coin', x, rawHeight(x, z) + 1.3, z);
      }
    }

    // Medical power-ups.
    const pickupRoll = rng();
    if (index >= 3 && pickupRoll < 0.22) {
      const z = z0 - 10 - rng() * (CHUNK_LEN - 20);
      const x = pathX(z) + (rng() * 2 - 1) * (PATH_HALF - 6);
      if (!nearFeature(x, z)) this.addPickup(pickupRoll < 0.12 ? 'medkit' : 'syringe', x, rawHeight(x, z) + 1.4, z);
    }
  }

  private buildFeature(f: JumpFeature): void {
    const ramp = this.addMesh(geos.ramp, mats.prop, f.rampX, f.rampBaseY, f.rampZ, 1, 0, true);
    ramp.rotation.x = -Math.atan(SLOPE);
    ramp.receiveShadow = true;

    if (f.hasGap) {
      for (const [dx, dz, alt] of [
        [-1, 0, false],
        [1, 0, false],
        [-1, 1, true],
        [1, 1, true],
      ] as const) {
        const x = f.gapX + dx * (f.gapHalfW + 0.8);
        const z = dz === 0 ? f.gapStart + 1 : f.gapEnd - 1;
        this.addMesh(alt ? geos.flagAlt : geos.flag, mats.prop, x, rawHeight(x, z) - 0.2, z, 1, dx > 0 ? Math.PI : 0, true);
      }
    }

    // Coin arc over the jump rewards hitting the kicker.
    const topZ = f.rampZ - f.rampLen;
    const topY = f.rampBaseY - SLOPE * f.rampLen + f.rampH;
    for (let i = 0; i < 8; i++) {
      const s = i / 7;
      const z = topZ - 4 - s * 30;
      const lin = topY - SLOPE * (topZ - z);
      this.addPickup('coin', f.rampX, lin + 2.5 + Math.sin(s * Math.PI) * 3.5, z);
    }
  }

  /** Per-frame cosmetic animation (spinning pickups, shaking trees). */
  animate(dt: number, time: number): void {
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.mesh.rotation.y += dt * (p.kind === 'coin' ? 3.5 : 1.8);
      p.mesh.position.y = p.y + Math.sin(time * 3 + p.phase) * 0.18;
    }
    for (const o of this.obstacles) {
      if (o.cooldown > 0) o.cooldown -= dt;
      if (o.shake > 0) {
        o.shake = Math.max(0, o.shake - dt * 1.6);
        o.mesh.rotation.z = Math.sin(time * 45) * o.shake * 0.12;
        o.mesh.rotation.x = Math.cos(time * 39) * o.shake * 0.08;
      }
    }
  }
}
