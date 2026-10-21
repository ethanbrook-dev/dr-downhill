import * as THREE from 'three';
import { approach, clamp, damp } from '../core/math';
import { PATH_HALF, groundHeight, pathX, rampSurface, rawHeight } from '../world/terrain';
import { DoctorModel } from './DoctorModel';

export interface SteerInput {
  steer: number;
  tuck: boolean;
  jump: boolean;
}

export const GRAVITY = 34;
const MAX_HEADING = 0.95;
const JUMP_VELOCITY = 12;
export const PLAYER_RADIUS = 0.55;
export const START_Z = -6;

export type LandingEvent = { airTime: number; impact: number };

export class Player {
  readonly model = new DoctorModel();
  readonly pos = new THREE.Vector3();
  vx = 0;
  vz = 0;
  vy = 0;
  heading = 0;
  steer = 0;
  speed = 0;
  grounded = true;
  tuck = false;
  /** Seconds of post-crash sluggishness. */
  slowTime = 0;
  slowFactor = 1;
  invuln = 0;
  crashTime = 0;
  tumble = 0;
  boost = 0;
  airTime = 0;
  /** Lateral slip between where the skis point and where we travel. */
  drift = 0;
  private lastGround = 0;
  private groundRate = 0;
  private wasOnRamp = false;

  reset(): void {
    this.pos.set(pathX(START_Z), 0, START_Z);
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
    this.lastGround = this.pos.y;
    this.groundRate = 0;
    this.vx = this.vy = this.vz = 0;
    this.heading = this.steer = this.speed = 0;
    this.grounded = true;
    this.slowTime = 0;
    this.slowFactor = 1;
    this.invuln = this.crashTime = this.tumble = this.boost = this.airTime = this.drift = 0;
    this.wasOnRamp = false;
    this.syncModel();
  }

  get crashed(): boolean {
    return this.crashTime > 0;
  }

  get actualSpeed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * Integrate one physics step. Returns a landing event when touching down.
   */
  step(dt: number, input: SteerInput, cruise: number): LandingEvent | null {
    let landing: LandingEvent | null = null;
    this.invuln = Math.max(0, this.invuln - dt);
    this.boost = Math.max(0, this.boost - dt);
    this.slowTime = Math.max(0, this.slowTime - dt);

    const control = this.crashed ? 0 : 1;
    this.crashTime = Math.max(0, this.crashTime - dt);
    this.tuck = control > 0 && input.tuck;
    this.steer = damp(this.steer, input.steer * control, 9, dt);

    // Heading follows the stick quickly on snow, sluggishly in the air.
    const maxHeading = MAX_HEADING * (this.tuck ? 0.55 : 1);
    this.heading = damp(this.heading, this.steer * maxHeading, this.grounded ? 6.5 : 1.8, dt);

    // Target speed: cruise, minus carving drag, plus tuck/boost.
    const carveDrag = 1 - 0.32 * Math.pow(Math.abs(Math.sin(this.heading)), 1.4);
    let target = cruise * carveDrag * (this.tuck ? 1.12 : 1) * (this.boost > 0 ? 1.4 : 1) * (this.slowTime > 0 ? this.slowFactor : 1);
    // Tumbling keeps you sliding downhill; well below target you power back up quickly.
    if (this.crashed) target = cruise * 0.35;
    const accel = this.speed < target ? (this.speed < target * 0.7 ? 20 : 9) + cruise * 0.12 : 18;
    if (this.grounded || this.crashed) this.speed = approach(this.speed, target, accel * dt);

    // Velocity lags heading slightly, which produces a drift/carve feel.
    const dvx = Math.sin(this.heading) * this.speed;
    const dvz = -Math.cos(this.heading) * this.speed;
    const grip = this.crashed ? 2 : this.grounded ? 5.5 : 0.4;
    this.vx = damp(this.vx, dvx, grip, dt);
    this.vz = damp(this.vz, dvz, grip, dt);
    this.drift = Math.abs(this.vx - dvx) + Math.abs(this.vz - dvz);

    // The valley walls push you back toward the piste.
    const off = this.pos.x - pathX(this.pos.z);
    const wall = Math.abs(off) - (PATH_HALF + 3);
    if (wall > 0) {
      this.vx -= Math.sign(off) * wall * 4 * dt;
      this.speed *= 1 - Math.min(0.5, wall * 0.04) * dt;
    }

    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;

    // Vertical: glue to the snow unless launched by a ramp, a gap, or a jump.
    const ground = groundHeight(this.pos.x, this.pos.z);
    const onRamp = rampSurface(this.pos.x, this.pos.z) > rawHeight(this.pos.x, this.pos.z) - 1;
    if (this.grounded) {
      const jump = input.jump && control > 0;
      const launched = this.wasOnRamp && !onRamp;
      // A drop far steeper than the slope we're riding means we skied off an edge.
      const droppedAway = (ground - this.lastGround) / dt < this.groundRate - 18;
      if (jump || launched || droppedAway) {
        // Keep the vertical velocity we had on the snow (e.g. up a kicker).
        this.grounded = false;
        const base = launched ? this.groundRate + 2 : Math.min(this.groundRate, 3);
        this.vy = base + (jump ? JUMP_VELOCITY : 0);
        this.airTime = 0;
      } else {
        this.groundRate = clamp((ground - this.lastGround) / dt, -60, 20);
        this.pos.y = ground;
        this.vy = this.groundRate;
      }
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      this.airTime += dt;
      if (this.pos.y <= ground) {
        const relV = this.vy - (ground - this.lastGround) / dt;
        this.pos.y = ground;
        this.grounded = true;
        this.groundRate = clamp((ground - this.lastGround) / dt, -60, 20);
        landing = { airTime: this.airTime, impact: Math.max(0, -relV) };
        this.model.land(Math.max(0, -relV));
      }
    }
    this.wasOnRamp = onRamp && this.grounded;
    this.lastGround = ground;

    this.tumble = this.crashed ? this.tumble + dt * 14 : damp(this.tumble % (Math.PI * 2), 0, 12, dt);
    return landing;
  }

  /** True if the doctor fell into a crevasse. */
  inGap(): boolean {
    return this.pos.y < rawHeight(this.pos.x, this.pos.z) - 3;
  }

  /**
   * Knock the doctor over. Returns false (and does nothing) while still
   * invulnerable from a previous crash, so one impact only ever counts once.
   */
  crash(fromX: number, fromZ: number): boolean {
    if (this.invuln > 0) return false;
    this.invuln = 2.2;
    this.crashTime = 0.75;
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.speed *= 0.45;
    // Knock sideways and keep sliding downhill, never back uphill into the clown.
    this.vx = (dx / d) * 8 + Math.sign(dx || 1) * 2;
    this.vz = Math.min(this.vz * 0.35, -3);
    this.vy = 7;
    this.grounded = false;
    this.airTime = 0;
    return true;
  }

  /** Temporary slowdown applied after a crash. */
  slowDown(seconds: number, factor: number): void {
    this.slowTime = Math.max(this.slowTime, seconds);
    this.slowFactor = factor;
  }

  syncModel(): void {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = -this.heading;
    // Blink while invulnerable.
    this.model.root.visible = this.invuln <= 0 || this.crashed || Math.floor(this.invuln * 14) % 2 === 0;
  }
}

