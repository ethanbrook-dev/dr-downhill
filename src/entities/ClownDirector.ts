import * as THREE from 'three';
import { clamp } from '../core/math';
import { PATH_HALF, featureAt, pathX } from '../world/terrain';
import type { World } from '../world/World';
import type { Obstacle } from '../world/Chunk';
import { CATCH_RADIUS, Clown, HAZARD_RADIUS, type ClownRole } from './Clown';
import { PLAYER_RADIUS, type Player } from './Player';

export interface ClownThreat {
  /** Distance to the main chaser, or Infinity. */
  nearest: number;
  /** -1..1 screen side of the chaser relative to the doctor. */
  side: number;
  /** Chaser is behind the doctor. */
  behind: boolean;
  count: number;
}

export interface ClownCallbacks {
  /** A clown tripped over a static obstacle. */
  trip: (c: Clown, o: Obstacle) => void;
  /** The doctor ran into a walking/skiing hazard clown. */
  hazardHit: (c: Clown) => void;
}

const RAGE_RAMP_SECONDS = 4;
/** No grab while the doctor's post-crash invulnerability is above this (about 1 s of grace). */
const CATCH_GRACE = 1.2;

/** Runs the main chaser plus the wandering and skiing hazard clowns. */
export class ClownDirector {
  readonly clowns: Clown[] = [];
  readonly chaser: Clown;
  readonly threat: ClownThreat = { nearest: Infinity, side: 0, behind: true, count: 0 };
  /** 0..1 ramp to normal chase speed once enraged. */
  rage = 0;
  private walkerTimer = 0;
  private skierTimer = 0;
  private paletteCounter = 1;

  constructor(private readonly scene: THREE.Scene) {
    this.chaser = new Clown('chaser', 0);
    this.clowns.push(this.chaser);
    scene.add(this.chaser.model.root);
  }

  reset(player: Player, cruise: number): void {
    for (const c of this.clowns) c.despawn();
    this.rage = 0;
    this.walkerTimer = 2.5;
    this.skierTimer = 9;
    const z = player.pos.z + 45;
    this.chaser.spawn(pathX(z), z, 0, cruise * 0.8);
  }

  /** Three crashes: the chaser enrages and starts ramping up to full speed. */
  enrage(): void {
    // No burst here: the speed ramps up over RAGE_RAMP_SECONDS so it's noticeable but fair.
    this.chaser.model.setEnraged(true);
  }

  calm(): void {
    this.rage = 0;
    this.chaser.model.setEnraged(false);
  }

  /** Pull the chaser in a bit after a crash (it closes in smoothly, never teleports). */
  surge(seconds: number): void {
    this.chaser.surge = Math.max(this.chaser.surge, seconds);
  }

  private acquire(role: ClownRole): Clown {
    let c = this.clowns.find((k) => !k.active && k.role === role);
    if (!c) {
      c = new Clown(role, this.paletteCounter++);
      this.clowns.push(c);
      this.scene.add(c.model.root);
    }
    return c;
  }

  private count(role: ClownRole): number {
    return this.clowns.filter((c) => c.active && c.role === role).length;
  }

  /** A spawn point is fair if it avoids jumps, static obstacles and other clowns. */
  private spawnOk(x: number, z: number, world: World): boolean {
    const f = featureAt(z);
    if (f && z < f.rampZ + 15 && z > f.gapEnd - 10 && Math.abs(x - f.rampX) < f.gapHalfW + 6) return false;
    for (const c of this.clowns) {
      if (c.active && c.role !== 'chaser' && Math.hypot(c.pos.x - x, c.pos.z - z) < 14) return false;
    }
    let blocked = false;
    world.forObstaclesNear(z, (o) => {
      if (Math.hypot(Math.max(0, Math.abs(o.x - x) - o.halfLen), o.z - z) < o.r + 4) blocked = true;
    });
    return !blocked;
  }

  /** Called once per frame: spawns hazard clowns ahead of the doctor. Returns what spawned. */
  updateSpawning(dt: number, elapsed: number, player: Player, world: World): 'walker' | 'crossing' | 'cruiser' | null {
    this.walkerTimer -= dt;
    this.skierTimer -= dt;
    const pz = player.pos.z;

    if (this.walkerTimer <= 0 && this.count('walker') < Math.min(8, 3 + Math.floor(elapsed / 40))) {
      this.walkerTimer = Math.max(2, 4.5 - elapsed / 60);
      for (let tries = 0; tries < 6; tries++) {
        const z = pz - 110 - Math.random() * 60;
        const x = pathX(z) + (Math.random() * 2 - 1) * (PATH_HALF + 6);
        if (!this.spawnOk(x, z, world)) continue;
        const c = this.acquire('walker');
        const erratic = Math.random() < 0.35;
        c.erratic = erratic;
        // Mostly walk across the slope, sometimes amble downhill.
        const across = (x > pathX(z) ? -1 : 1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.8);
        c.spawn(x, z, Math.random() < 0.75 ? across : Math.random() * Math.PI * 2, erratic ? 3.5 : 1 + Math.random() * 1.2);
        return 'walker';
      }
    }

    if (this.skierTimer <= 0 && elapsed > 6 && this.count('skier') < Math.min(3, 1 + Math.floor(elapsed / 60))) {
      this.skierTimer = Math.max(4.5, 10 - elapsed / 40);
      for (let tries = 0; tries < 6; tries++) {
        const crossing = Math.random() < 0.6;
        const z = pz - (crossing ? 95 + Math.random() * 45 : 100 + Math.random() * 50);
        const side = Math.random() < 0.5 ? -1 : 1;
        const x = crossing ? pathX(z) + side * (PATH_HALF + 6) : pathX(z) + (Math.random() * 2 - 1) * (PATH_HALF - 6);
        if (!this.spawnOk(x, z, world)) continue;
        const c = this.acquire('skier');
        c.cruising = !crossing;
        c.spawn(x, z, crossing ? -side * (1.1 + Math.random() * 0.3) : 0, crossing ? 12 + Math.random() * 4 : 15);
        return crossing ? 'crossing' : 'cruiser';
      }
    }
    return null;
  }

  /**
   * Physics step for all clowns. Returns the chaser if it caught the doctor.
   */
  step(dt: number, player: Player, world: World, cruise: number, crashes: number, cb: ClownCallbacks): Clown | null {
    if (crashes >= 3) this.rage = Math.min(1, this.rage + dt / RAGE_RAMP_SECONDS);
    let caught: Clown | null = null;

    for (const c of this.clowns) {
      if (!c.active) continue;
      if (c.role === 'chaser') {
        c.stepChaser(dt, player, cruise, { crashes, rage: this.rage });
        if (c.stumble <= 0) {
          // Occasionally trips over things on the piste; otherwise slides around them.
          world.forObstaclesNear(c.pos.z, (o) => {
            if (o.kind === 'drift' || c.stumble > 0) return;
            const dx = Math.max(0, Math.abs(c.pos.x - o.x) - o.halfLen);
            if (Math.hypot(dx, c.pos.z - o.z) < o.r + 0.45 && c.trip()) cb.trip(c, o);
          });
          this.slideAroundObstacles(c, world);
        }
        // The grab: only once the doctor is back on his feet with a moment's grace after any crash.
        const grace = player.crashed || player.invuln > CATCH_GRACE;
        if (c.stumble <= 0 && !grace && c.distanceTo(player) < CATCH_RADIUS && Math.abs(c.pos.y - player.pos.y) < 1.8) {
          caught = c;
        }
        continue;
      }

      c.stepHazard(dt, cruise);
      if (!c.active) continue;
      if (c.knocked <= 0) this.slideAroundObstacles(c, world);
      // Recycle once well behind the camera or far off into the forest.
      if (c.pos.z - player.pos.z > 30 || Math.abs(c.pos.x - pathX(c.pos.z)) > PATH_HALF + 45) {
        c.despawn();
        continue;
      }
      // Moving obstacle: counts as a crash, once per clown. You can jump over them.
      if (!c.struck && c.knocked <= 0 && c.distanceTo(player) < HAZARD_RADIUS + PLAYER_RADIUS && player.pos.y - c.pos.y < 1.9) {
        cb.hazardHit(c);
      }
    }
    return caught;
  }

  /** Hazard clowns slide around trees and rocks instead of walking through them. */
  private slideAroundObstacles(c: Clown, world: World): void {
    world.forObstaclesNear(c.pos.z, (o) => {
      if (o.kind === 'drift') return;
      const dx = c.pos.x - o.x;
      const dz = c.pos.z - o.z;
      const ex = Math.max(0, Math.abs(dx) - o.halfLen) * Math.sign(dx);
      const d = Math.hypot(ex, dz);
      const min = o.r + 0.5;
      if (d < min && d > 0.001) {
        c.pos.x += (ex / d) * (min - d);
        c.pos.z += (dz / d) * (min - d);
      }
    });
  }

  sync(dt: number, player: Player): void {
    const t = this.threat;
    t.count = 0;
    for (const c of this.clowns) {
      if (!c.active) continue;
      c.sync(dt);
      t.count++;
    }
    const ch = this.chaser;
    t.nearest = ch.active ? ch.distanceTo(player) : Infinity;
    t.side = clamp((ch.pos.x - player.pos.x) / 12, -1, 1);
    t.behind = ch.pos.z > player.pos.z;
  }
}
