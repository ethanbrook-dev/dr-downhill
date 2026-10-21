import * as THREE from 'three';
import { clamp, damp, lerp, wrapAngle } from '../core/math';
import { PATH_HALF, gapDepth, groundHeight, pathX } from '../world/terrain';
import { ClownModel, CLOWN_PALETTES, type ClownStyle } from './ClownModel';
import type { Player } from './Player';

export const CATCH_RADIUS = 1.5;
/** Radius used when the doctor smacks into a hazard clown. */
export const HAZARD_RADIUS = 1.0;

/**
 * chaser: the one main clown hunting the doctor; the only one that can grab him.
 * walker: wanders the slope on foot, a moving obstacle.
 * skier:  crosses or cruises down the slope, a fast moving obstacle.
 */
export type ClownRole = 'chaser' | 'walker' | 'skier';

/** Leash distance the slow chaser hangs back at for 0, 1 and 2 crashes. */
const CHASER_LEASH = [60, 42, 24];
/** Beyond this the enraged chaser keeps pace rather than vanishing behind. */
const CHASER_MAX_GAP = 75;
const CHASER_SLOW = 0.72;
/** Pre-enrage, the chaser backs off to this when it gets closer than its leash. */
const CHASER_BACKOFF = 0.6;
const CHASER_NORMAL = 1.0;
/** Player invulnerability above this means he is still recovering from a crash. */
const RECOVERY_INVULN = 0;

export interface ChaserState {
  crashes: number;
  /** 0..1 ramp from slow to normal speed after the third crash. */
  rage: number;
}

export class Clown {
  readonly model: ClownModel;
  readonly pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  steer = 0;
  stumble = 0;
  tumble = 0;
  phase = 0;
  lunge = 0;
  active = false;
  grabbing = false;
  /** Short burst of extra speed (enraged chaser closing in after a crash). */
  surge = 0;
  /** Seconds before the chaser can trip again. */
  tripCooldown = 0;

  // Hazard behaviour.
  baseSpeed = 0;
  erratic = false;
  cruising = false;
  private wanderTimer = 0;
  private sway = Math.random() * 10;
  /** Already collided with the doctor this life; never counts twice. */
  struck = false;
  /** Seconds left of being sent flying after a collision. */
  knocked = 0;
  private readonly knockVel = new THREE.Vector3();

  constructor(readonly role: ClownRole, paletteIndex: number) {
    const kind = role === 'walker' ? 'runner' : 'skier';
    const scale = role === 'chaser' ? 1.2 : 1;
    this.model = new ClownModel(kind, CLOWN_PALETTES[paletteIndex % CLOWN_PALETTES.length], scale);
  }

  spawn(x: number, z: number, heading: number, speed: number): void {
    this.pos.set(x, groundHeight(x, z), z);
    this.heading = heading;
    this.speed = this.baseSpeed = speed;
    this.steer = this.stumble = this.tumble = this.lunge = this.surge = this.knocked = this.tripCooldown = 0;
    this.wanderTimer = 0;
    this.active = true;
    this.grabbing = false;
    this.struck = false;
    this.model.root.visible = true;
    this.model.setEnraged(false);
    this.sync(0);
  }

  despawn(): void {
    this.active = false;
    this.model.root.visible = false;
  }

  /** Distance to the player in the XZ plane. */
  distanceTo(p: Player): number {
    return Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
  }

  /** Main chaser AI. */
  stepChaser(dt: number, player: Player, cruise: number, state: ChaserState): void {
    // Aim slightly ahead of the doctor.
    const tx = player.pos.x + player.vx * 0.3;
    const tz = player.pos.z + player.vz * 0.3;
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const dist = this.distanceTo(player);
    this.turnToward(Math.atan2(dx, -dz), 2.4, dt);

    const enraged = state.crashes >= 3;
    const hold = enraged ? CHASER_MAX_GAP : CHASER_LEASH[Math.min(state.crashes, 2)];
    let target: number;
    if (enraged) {
      // Ramps from slow to normal chase speed over a few seconds; can now really catch you.
      target = cruise * lerp(CHASER_SLOW, CHASER_NORMAL, state.rage);
      if (this.surge > 0) target += 5;
    } else {
      // Before the third crash the clown tracks its leash distance: it closes in
      // when farther, and once inside the leash it is never faster than the doctor,
      // so it cannot run you down before it is enraged.
      const t = clamp((dist - (hold - 15)) / 15, 0, 1);
      target = Math.min(cruise * lerp(CHASER_BACKOFF, CHASER_SLOW, t), player.actualSpeed * 0.9);
    }
    this.surge = Math.max(0, this.surge - dt);
    // Close a too-large gap smoothly (never teleport), at most 10 m/s faster than the doctor.
    if (dist > hold) target = Math.max(target, player.actualSpeed + Math.min(10, (dist - hold) * 0.5));
    this.lunge = damp(this.lunge, enraged && dist < 7 ? 1 : 0, 5, dt);
    target += this.lunge * 5;

    // While the doctor is picking himself up after a crash, the clown can't
    // exploit it by much: no cheap kills right after a hit.
    if (player.crashed || player.invuln > RECOVERY_INVULN) {
      const cap = player.actualSpeed + 4;
      target = Math.min(target, cap);
      this.speed = Math.min(this.speed, Math.max(cap, this.speed - 30 * dt));
    }

    this.tripCooldown = Math.max(0, this.tripCooldown - dt);
    this.moveForward(dt, target, 2.5);
    this.phase += dt * 2;
  }

  /** Walking and skiing hazard clowns. */
  stepHazard(dt: number, cruise: number): void {
    if (this.knocked > 0) {
      // Sent flying by the doctor.
      this.knocked -= dt;
      this.knockVel.y -= 30 * dt;
      this.pos.addScaledVector(this.knockVel, dt);
      this.tumble += dt * 12;
      this.pos.y = Math.max(this.pos.y, groundHeight(this.pos.x, this.pos.z));
      if (this.knocked <= 0) this.despawn();
      return;
    }

    const off = this.pos.x - pathX(this.pos.z);
    if (this.role === 'walker') {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        if (this.erratic) {
          this.wanderTimer = 0.5 + Math.random() * 1.0;
          this.baseSpeed = 2.5 + Math.random() * 2.5;
          this.heading += (Math.random() - 0.5) * 3;
        } else {
          this.wanderTimer = 2.5 + Math.random() * 3;
          this.heading += (Math.random() - 0.5) * 1.2;
        }
      }
      // Stay roughly on the piste so they keep crossing the skiing line.
      if (Math.abs(off) > PATH_HALF + 8) this.turnToward(Math.atan2(-Math.sign(off), 0), 2, dt);
      this.moveForward(dt, this.baseSpeed, 4);
      this.phase += dt * (3 + this.speed * 1.4);
    } else {
      if (this.cruising) {
        // Slow downhill slalom the doctor has to overtake.
        this.sway += dt;
        this.heading = Math.sin(this.sway * 1.3) * 0.55 - clamp(off / 40, -0.4, 0.4);
        this.moveForward(dt, cruise * 0.45, 2);
      } else {
        this.moveForward(dt, this.baseSpeed, 2);
      }
      this.steer = damp(this.steer, Math.sin(this.sway * 1.3), 4, dt);
      this.phase += dt * 2;
    }
  }

  private turnToward(desired: number, rate: number, dt: number): void {
    if (this.stumble > 0) return;
    const diff = wrapAngle(desired - this.heading);
    this.heading += clamp(diff, -rate * dt, rate * dt);
    this.steer = damp(this.steer, clamp(diff * 2, -1, 1), 6, dt);
  }

  private moveForward(dt: number, target: number, accel: number): void {
    if (this.stumble > 0) {
      this.stumble -= dt;
      target = 4;
      this.tumble += dt * 9;
    } else {
      this.tumble = damp(this.tumble % (Math.PI * 2), 0, 10, dt);
    }
    this.speed = damp(this.speed, target, accel, dt);
    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.z - Math.cos(this.heading) * this.speed * dt;
    // Wanderers turn around at crevasse edges rather than falling in.
    if (this.role !== 'chaser' && gapDepth(nx, nz) > 0) {
      this.heading += Math.PI;
      return;
    }
    this.pos.x = nx;
    this.pos.z = nz;
    this.pos.y = groundHeight(nx, nz);
  }

  /** Returns true if the clown actually tripped (it can't trip again for a while). */
  trip(): boolean {
    if (this.stumble > 0 || this.tripCooldown > 0) return false;
    this.stumble = 1.3;
    this.tripCooldown = 6;
    this.speed *= 0.3;
    return true;
  }

  /** Bowl the clown over after the doctor ploughs into it. */
  knock(fromVx: number, fromVz: number): void {
    this.struck = true;
    this.knocked = 1.4;
    this.knockVel.set(fromVx * 0.5 + (Math.random() - 0.5) * 6, 10, fromVz * 0.5);
  }

  private get style(): ClownStyle {
    return this.role === 'chaser' ? 'chase' : this.role === 'walker' ? 'walk' : 'ski';
  }

  sync(dt: number): void {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = -this.heading;
    this.model.update(dt, {
      style: this.style,
      phase: this.phase,
      steer: this.steer,
      tumble: this.tumble,
      grabbing: this.grabbing,
      lunge: this.lunge,
    });
  }
}
