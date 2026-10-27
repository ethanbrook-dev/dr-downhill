import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp } from '../core/math';
import { PATH_HALF, featureAt, gapDepth, groundHeight, pathX } from '../world/terrain';
import type { World } from '../world/World';
import { PLAYER_RADIUS, type Player } from './Player';
import { toon } from './toon';

/**
 * behind: spawns uphill and rolls down faster than the doctor; sidestep or jump it.
 * cross:  rolls across the piste ahead of the doctor.
 * slow:   rolls down the piste ahead, slower than the doctor, who overtakes it.
 */
export type CookieKind = 'behind' | 'cross' | 'slow';

const DOUGH = 0xd9a05b;
const CHIP = 0x3a2013;
/** The doctor must be this fraction of the radius above the boulder's base to hop it. */
const JUMP_CLEAR = 0.85;
/** "Behind" boulders stop steering toward the doctor this far uphill, so there is time to dodge. */
const LOCK_DISTANCE = 38;

let bodyGeo: THREE.BufferGeometry | null = null;
let chipGeo: THREE.BufferGeometry | null = null;

/** Lumpy unit sphere plus one merged geometry of chocolate chips studded over it. */
function buildGeometry(): { body: THREE.BufferGeometry; chips: THREE.BufferGeometry } {
  if (!bodyGeo || !chipGeo) {
    bodyGeo = new THREE.IcosahedronGeometry(1, 2);
    const pos = bodyGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Position-based so duplicated vertices stay welded.
      const lump = 1 + 0.06 * Math.sin(v.x * 5.1 + v.y * 3.7) * Math.cos(v.z * 4.3 + v.x * 2.1);
      v.multiplyScalar(lump);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    bodyGeo.computeVertexNormals();

    const pieces: THREE.BufferGeometry[] = [];
    const n = 22;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      // Fibonacci sphere keeps the chips evenly scattered.
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.399963;
      const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const size = 0.15 + ((i * 37) % 7) * 0.02;
      const g = new THREE.DodecahedronGeometry(size, 0);
      const m = new THREE.Matrix4().compose(
        dir.clone().multiplyScalar(0.99),
        new THREE.Quaternion().setFromUnitVectors(up, dir),
        new THREE.Vector3(1.3, 0.55, 1),
      );
      g.applyMatrix4(m);
      pieces.push(g);
    }
    chipGeo = mergeGeometries(pieces)!;
    for (const g of pieces) g.dispose();
  }
  return { body: bodyGeo, chips: chipGeo };
}

export class Cookie {
  readonly root = new THREE.Group();
  private readonly ball = new THREE.Group();
  readonly pos = new THREE.Vector3();
  vx = 0;
  vz = 0;
  radius = 1.6;
  kind: CookieKind = 'behind';
  active = false;
  /** Already hit (or been smashed by) the doctor; never counts twice. */
  struck = false;

  constructor() {
    const { body, chips } = buildGeometry();
    const dough = new THREE.Mesh(body, toon(DOUGH));
    const chip = new THREE.Mesh(chips, toon(CHIP));
    dough.castShadow = chip.castShadow = true;
    this.ball.add(dough, chip);
    this.root.add(this.ball);
    this.root.visible = false;
  }

  spawn(kind: CookieKind, x: number, z: number, vx: number, vz: number, radius: number): void {
    this.kind = kind;
    this.radius = radius;
    this.vx = vx;
    this.vz = vz;
    this.struck = false;
    this.active = true;
    this.pos.set(x, groundHeight(x, z), z);
    this.ball.scale.setScalar(radius);
    this.ball.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    this.root.visible = true;
    this.sync(0);
  }

  despawn(): void {
    this.active = false;
    this.root.visible = false;
  }

  /** Roll along the snow. */
  move(dt: number): void {
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
  }

  sync(dt: number): void {
    this.root.position.set(this.pos.x, this.pos.y + this.radius * 0.95, this.pos.z);
    const s = Math.hypot(this.vx, this.vz);
    if (s > 0.01 && dt > 0) {
      // Rolling without slipping: the axis is up × velocity.
      const axis = new THREE.Vector3(this.vz, 0, -this.vx).normalize();
      this.ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (s * dt) / this.radius));
    }
  }
}

export interface CookieCallbacks {
  /** The doctor ran into a cookie boulder. */
  hit: (c: Cookie) => void;
}

/** Spawns and runs the rolling cookie boulders. */
export class CookieDirector {
  readonly cookies: Cookie[] = [];
  /** Distance to the nearest boulder rolling in from behind, or Infinity. */
  nearestBehind = Infinity;
  private behindTimer = 0;
  private aheadTimer = 0;

  constructor(scene: THREE.Scene) {
    // A fixed pool; if it is exhausted a spawn is simply skipped.
    for (let i = 0; i < 8; i++) {
      const c = new Cookie();
      this.cookies.push(c);
      scene.add(c.root);
    }
  }

  reset(): void {
    for (const c of this.cookies) c.despawn();
    this.behindTimer = 14;
    this.aheadTimer = 6;
    this.nearestBehind = Infinity;
  }

  private acquire(): Cookie | null {
    return this.cookies.find((c) => !c.active) ?? null;
  }

  private count(kinds: CookieKind[]): number {
    return this.cookies.filter((c) => c.active && kinds.includes(c.kind)).length;
  }

  /** Keep spawns off jumps, other boulders and static obstacles. */
  private spawnOk(x: number, z: number, world: World): boolean {
    const f = featureAt(z);
    if (f && z < f.rampZ + 20 && z > f.gapEnd - 15) return false;
    for (const c of this.cookies) {
      if (c.active && Math.hypot(c.pos.x - x, c.pos.z - z) < 25) return false;
    }
    let blocked = false;
    world.forObstaclesNear(z, (o) => {
      if (Math.hypot(Math.max(0, Math.abs(o.x - x) - o.halfLen), o.z - z) < o.r + 3) blocked = true;
    });
    return !blocked;
  }

  /** Once per frame. Returns 'behind' when a boulder starts rolling in from uphill. */
  updateSpawning(dt: number, elapsed: number, player: Player, cruise: number, world: World): 'behind' | 'ahead' | null {
    this.behindTimer -= dt;
    this.aheadTimer -= dt;
    const pz = player.pos.z;

    if (this.behindTimer <= 0 && this.count(['behind']) < (elapsed > 120 ? 2 : 1)) {
      this.behindTimer = Math.max(8, 17 - elapsed / 18);
      const z = pz + 95;
      const x = clamp(player.pos.x + (Math.random() - 0.5) * 6, pathX(z) - PATH_HALF, pathX(z) + PATH_HALF);
      const c = this.spawnOk(x, z, world) ? this.acquire() : null;
      if (c) {
        c.spawn('behind', x, z, 0, -(Math.max(cruise, player.actualSpeed) * 1.18 + 3), 1.5 + Math.random() * 0.5);
        return 'behind';
      }
    }

    if (this.aheadTimer <= 0 && this.count(['cross', 'slow']) < Math.min(4, 1 + Math.floor(elapsed / 45))) {
      this.aheadTimer = Math.max(4.5, 11 - elapsed / 30);
      for (let tries = 0; tries < 5; tries++) {
        const cross = Math.random() < 0.6;
        const z = pz - (110 + Math.random() * 50);
        const side = Math.random() < 0.5 ? -1 : 1;
        const x = cross ? pathX(z) + side * (PATH_HALF - 2) : pathX(z) + (Math.random() * 2 - 1) * (PATH_HALF - 8);
        if (!this.spawnOk(x, z, world)) continue;
        const c = this.acquire();
        if (!c) break;
        if (cross) c.spawn('cross', x, z, -side * (11 + Math.random() * 5), -cruise * 0.3, 1.2 + Math.random() * 0.5);
        else c.spawn('slow', x, z, (Math.random() - 0.5) * 2, -cruise * 0.4, 1.4 + Math.random() * 0.5);
        return 'ahead';
      }
    }
    return null;
  }

  /** Physics step for all boulders. */
  step(dt: number, player: Player, cruise: number, world: World, cb: CookieCallbacks): void {
    for (const c of this.cookies) {
      if (!c.active) continue;

      if (c.kind === 'behind') {
        const gap = c.pos.z - player.pos.z;
        const targetVz = -(Math.max(cruise, player.actualSpeed) * 1.18 + 3);
        c.vz = damp(c.vz, targetVz, 2, dt);
        if (gap > LOCK_DISTANCE) {
          // Homes in on the doctor until it commits to its line, so you can't just hide in a corner.
          c.vx = damp(c.vx, clamp((player.pos.x + player.vx * 0.4 - c.pos.x) * 1.2, -14, 14), 3, dt);
        } else {
          c.vx = damp(c.vx, 0, 1.2, dt);
        }
      }

      c.move(dt);
      this.slideAroundObstacles(c, world);

      // Fell into a crevasse, left the piste, or is long gone behind or ahead of the doctor.
      const fell = gapDepth(c.pos.x, c.pos.z) > 0;
      const behindCam = c.pos.z - player.pos.z > (c.kind === 'behind' ? 130 : 35);
      const gone = player.pos.z - c.pos.z > 170 || Math.abs(c.pos.x - pathX(c.pos.z)) > PATH_HALF + 40;
      if (fell || behindCam || gone) {
        c.despawn();
        continue;
      }

      const dx = player.pos.x - c.pos.x;
      const dz = player.pos.z - c.pos.z;
      if (!c.struck && Math.hypot(dx, dz) < c.radius + PLAYER_RADIUS * 0.8 && player.pos.y - c.pos.y < c.radius * JUMP_CLEAR) {
        cb.hit(c);
      }
    }
  }

  /** Boulders swerve around trees and rocks rather than rolling through them. */
  private slideAroundObstacles(c: Cookie, world: World): void {
    world.forObstaclesNear(c.pos.z, (o) => {
      if (o.kind === 'drift') return;
      const dx = c.pos.x - o.x;
      const dz = c.pos.z - o.z;
      const ex = Math.max(0, Math.abs(dx) - o.halfLen) * Math.sign(dx);
      const d = Math.hypot(ex, dz);
      const min = o.r + c.radius * 0.7;
      if (d < min && d > 0.001) {
        c.pos.x += (ex / d) * (min - d);
        c.pos.z += (dz / d) * (min - d);
      }
    });
  }

  sync(dt: number, player: Player): void {
    let nearest = Infinity;
    for (const c of this.cookies) {
      if (!c.active) continue;
      c.sync(dt);
      if (c.kind === 'behind' && c.pos.z > player.pos.z) nearest = Math.min(nearest, c.pos.z - player.pos.z);
    }
    this.nearestBehind = nearest;
  }
}
