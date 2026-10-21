import * as THREE from 'three';
import { damp } from '../core/math';
import { add, pivot, toon } from './toon';

export interface DoctorPose {
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** 0..1 fraction of top speed */
  speedN: number;
  airborne: boolean;
  tuck: boolean;
  /** Crash tumble progress, 0 when upright. */
  tumble: number;
  /** -1..1: which way to glance back at a nearby clown (0 = look ahead). */
  lookBack: number;
  panic: number;
  caught: boolean;
}

const COAT = 0xf5f8fc;
const SKIN = 0xffcfa3;
const HAIR = 0xd9662a;
const GLOVE = 0x3fb6ff;
const PANTS = 0x2d4a8a;
const SKI = 0xff4a2b;
const BOOT = 0x2b2f3a;

/** The good doctor, built from primitives. Faces -Z (downhill). */
export class DoctorModel {
  readonly root = new THREE.Group();
  private readonly rig: THREE.Group;
  private readonly torso: THREE.Group;
  private readonly head: THREE.Group;
  private readonly tail: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly poleL: THREE.Group;
  private readonly poleR: THREE.Group;
  private readonly skiL: THREE.Group;
  private readonly skiR: THREE.Group;
  private readonly skis: THREE.Group;
  private time = 0;
  private lean = 0;
  private squash = 0;

  constructor() {
    this.skis = pivot(this.root);
    this.skiL = this.buildSki(-0.17);
    this.skiR = this.buildSki(0.17);

    this.rig = pivot(this.root);
    for (const x of [-0.13, 0.13]) {
      add(this.rig, new THREE.CylinderGeometry(0.085, 0.08, 0.4, 7), toon(PANTS), x, 0.365, -0.06).rotation.x = -0.315;
      add(this.rig, new THREE.CylinderGeometry(0.11, 0.095, 0.42, 7), toon(PANTS), x, 0.735, -0.05).rotation.x = 0.36;
    }

    this.torso = pivot(this.rig, 0, 0.92, 0);
    add(this.torso, new THREE.CylinderGeometry(0.24, 0.29, 0.62, 10), toon(COAT), 0, 0.31, 0);
    add(this.torso, new THREE.SphereGeometry(0.27, 12, 8), toon(COAT), 0, 0.58, 0).scale.set(1.05, 0.5, 0.85);
    // Red cross on the back so the doctor reads clearly from the chase camera.
    add(this.torso, new THREE.BoxGeometry(0.2, 0.06, 0.02), toon(0xe8202f), 0, 0.4, 0.268);
    add(this.torso, new THREE.BoxGeometry(0.06, 0.2, 0.02), toon(0xe8202f), 0, 0.4, 0.268);
    // Shirt, tie and stethoscope on the front.
    add(this.torso, new THREE.BoxGeometry(0.15, 0.2, 0.02), toon(0x9fd3ff), 0, 0.5, -0.245);
    add(this.torso, new THREE.BoxGeometry(0.05, 0.2, 0.02), toon(0xe8202f), 0, 0.44, -0.258);
    const steth = toon(0x58606e);
    add(this.torso, new THREE.TorusGeometry(0.19, 0.022, 6, 18), steth, 0, 0.66, 0).rotation.x = Math.PI / 2;
    add(this.torso, new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5), steth, -0.09, 0.5, -0.235);
    add(this.torso, new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5), steth, 0.09, 0.5, -0.235);
    add(this.torso, new THREE.CylinderGeometry(0.055, 0.055, 0.03, 10), toon(0xdfe6ee, { emissive: 0x222222 }), 0.09, 0.34, -0.265).rotation.x =
      Math.PI / 2;
    add(this.torso, new THREE.CylinderGeometry(0.08, 0.09, 0.14, 8), toon(SKIN), 0, 0.68, 0);

    this.tail = pivot(this.torso, 0, 0.06, 0);
    add(this.tail, new THREE.CylinderGeometry(0.29, 0.38, 0.5, 12, 1, true), toon(COAT, { side: THREE.DoubleSide }), 0, -0.25, 0);

    this.head = pivot(this.torso, 0, 0.7, 0);
    this.buildHead();

    [this.armL, this.poleL] = this.buildArm(-1);
    [this.armR, this.poleR] = this.buildArm(1);
  }

  private buildSki(x: number): THREE.Group {
    const g = pivot(this.skis, x, 0, 0);
    add(g, new THREE.BoxGeometry(0.15, 0.05, 1.85), toon(SKI), 0, 0.025, 0);
    add(g, new THREE.BoxGeometry(0.15, 0.05, 0.34), toon(SKI), 0, 0.09, -1.04).rotation.x = 0.55;
    add(g, new THREE.BoxGeometry(0.15, 0.05, 0.2), toon(SKI), 0, 0.05, 0.99).rotation.x = -0.3;
    add(g, new THREE.BoxGeometry(0.2, 0.24, 0.34), toon(BOOT), 0, 0.17, 0.02);
    add(g, new THREE.BoxGeometry(0.19, 0.08, 0.3), toon(SKI), 0, 0.3, 0.03);
    return g;
  }

  private buildHead(): void {
    const h = this.head;
    add(h, new THREE.SphereGeometry(0.22, 14, 10), toon(SKIN), 0, 0.22, 0);
    add(h, new THREE.SphereGeometry(0.05, 8, 6), toon(SKIN), -0.22, 0.22, 0.01);
    add(h, new THREE.SphereGeometry(0.05, 8, 6), toon(SKIN), 0.22, 0.22, 0.01);
    add(h, new THREE.SphereGeometry(0.045, 8, 6), toon(0xffb98a), 0, 0.2, -0.225);

    // Wild orange hair, mostly visible from behind.
    const hair = toon(HAIR);
    const tufts: [number, number, number, number][] = [
      [0, 0.38, 0.03, 0.15],
      [-0.13, 0.33, 0.07, 0.12],
      [0.13, 0.33, 0.07, 0.12],
      [0, 0.27, 0.15, 0.14],
      [-0.17, 0.22, 0.08, 0.1],
      [0.17, 0.22, 0.08, 0.1],
      [-0.08, 0.16, 0.17, 0.1],
      [0.08, 0.16, 0.17, 0.1],
      [0, 0.38, -0.1, 0.11],
    ];
    for (const [x, y, z, r] of tufts) add(h, new THREE.IcosahedronGeometry(r, 0), hair, x, y, z);
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      const spike = add(h, new THREE.ConeGeometry(0.05, 0.18, 5), hair, Math.sin(a) * 0.12, 0.48, 0.02 + Math.cos(a) * 0.04);
      spike.rotation.z = -a * 0.8;
    }

    // Head mirror: the classic doctor silhouette.
    add(h, new THREE.TorusGeometry(0.225, 0.022, 6, 18), toon(0x30343f), 0, 0.31, 0).rotation.x = Math.PI / 2;
    add(h, new THREE.CylinderGeometry(0.08, 0.08, 0.02, 14), toon(0xe6edf5, { emissive: 0x555555 }), 0, 0.36, -0.215).rotation.x =
      Math.PI / 2 - 0.3;

    // Panicked face.
    const white = toon(0xffffff);
    const black = toon(0x111111);
    for (const s of [-1, 1]) {
      add(h, new THREE.SphereGeometry(0.068, 10, 8), white, s * 0.08, 0.26, -0.18);
      add(h, new THREE.SphereGeometry(0.022, 6, 5), black, s * 0.075, 0.27, -0.245);
      const brow = add(h, new THREE.BoxGeometry(0.1, 0.022, 0.02), toon(0x8a3a14), s * 0.085, 0.37, -0.2);
      brow.rotation.z = s * -0.4;
    }
    add(h, new THREE.SphereGeometry(0.07, 10, 8), toon(0x7a1020), 0, 0.1, -0.185).scale.set(1.2, 1, 0.5);
    add(h, new THREE.BoxGeometry(0.1, 0.025, 0.02), white, 0, 0.145, -0.215);
    add(h, new THREE.SphereGeometry(0.03, 6, 5), toon(0x8fd6ff, { emissive: 0x224466 }), 0.2, 0.33, -0.08).scale.set(0.8, 1.3, 0.8);
  }

  private buildArm(side: number): [THREE.Group, THREE.Group] {
    const arm = pivot(this.torso, side * 0.3, 0.56, 0);
    add(arm, new THREE.CylinderGeometry(0.075, 0.065, 0.48, 8), toon(COAT), 0, -0.24, 0);
    add(arm, new THREE.SphereGeometry(0.085, 8, 6), toon(GLOVE), 0, -0.5, 0);
    const pole = pivot(arm, 0, -0.5, 0);
    add(pole, new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), toon(0x1e2028), 0, 0, 0);
    add(pole, new THREE.CylinderGeometry(0.014, 0.014, 1.3, 5), toon(0x9aa3b5), 0, -0.65, 0);
    add(pole, new THREE.TorusGeometry(0.06, 0.012, 4, 10), toon(0x1e2028), 0, -1.2, 0).rotation.x = Math.PI / 2;
    return [arm, pole];
  }

  update(dt: number, p: DoctorPose): void {
    this.time += dt;
    const t = this.time;
    const air = p.airborne ? 1 : 0;

    this.lean = damp(this.lean, -p.steer * (0.45 - air * 0.25), 10, dt);
    this.rig.rotation.z = this.lean;
    this.rig.rotation.x = -p.tumble;
    this.squash = damp(this.squash, 0, 8, dt);
    this.rig.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5);

    const crouch = p.tuck ? 0.75 : 0.3 + p.speedN * 0.15;
    this.torso.rotation.x = damp(this.torso.rotation.x, -crouch, 8, dt);
    this.torso.position.y = damp(this.torso.position.y, p.tuck ? 0.84 : 0.92, 8, dt);
    this.torso.rotation.y = damp(this.torso.rotation.y, p.steer * 0.2, 8, dt);

    // Coat tail flaps harder at speed.
    this.tail.rotation.x = 0.2 + p.speedN * 0.5 + air * 0.4 + Math.sin(t * 30) * 0.07 * (0.3 + p.speedN);

    // Arms: tucked, pole-planting, or flailing.
    let ax: number;
    let az: number;
    let pole: number;
    const flail = p.caught ? 1 : air * 0.8 + p.panic * 0.25;
    if (p.caught) {
      ax = 2.6 + Math.sin(t * 22) * 0.6;
      az = 0.9;
      pole = 0.4;
    } else if (p.tuck) {
      ax = 1.1;
      az = 0.25;
      pole = -2.4;
    } else {
      ax = 0.75 - p.speedN * 0.25;
      az = 0.3;
      pole = -1.15;
    }
    const wave = Math.sin(t * 17);
    this.armL.rotation.x = damp(this.armL.rotation.x, ax + wave * flail, 14, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, ax - wave * flail, 14, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, -(az + flail * 1.1 + p.steer * 0.25), 14, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, az + flail * 1.1 - p.steer * 0.25, 14, dt);
    this.poleL.rotation.x = damp(this.poleL.rotation.x, pole, 10, dt);
    this.poleR.rotation.x = damp(this.poleR.rotation.x, pole, 10, dt);

    // Glance back over the shoulder when clowns are close.
    const look = p.caught ? Math.sin(t * 9) * 0.8 : p.lookBack * 2.0;
    this.head.rotation.y = damp(this.head.rotation.y, look, 6, dt);
    this.head.rotation.z = Math.sin(t * 11) * 0.03 * (1 + p.panic);
    this.head.position.y = 0.7 + Math.sin(t * 14) * 0.012 * (1 + p.speedN);

    // Skis edge into turns; in the air they splay comically.
    const edge = -p.steer * 0.3 * (1 - air);
    this.skiL.rotation.z = damp(this.skiL.rotation.z, edge, 12, dt);
    this.skiR.rotation.z = damp(this.skiR.rotation.z, edge, 12, dt);
    this.skiL.rotation.y = damp(this.skiL.rotation.y, air * (0.18 + Math.sin(t * 8) * 0.12), 8, dt);
    this.skiR.rotation.y = damp(this.skiR.rotation.y, -air * (0.18 + Math.sin(t * 8) * 0.12), 8, dt);
    this.skis.rotation.x = damp(this.skis.rotation.x, air * 0.15, 6, dt);
    this.skis.rotation.z = this.lean * 0.4;
    this.skis.visible = true;
  }

  /** Brief landing squash. */
  land(intensity: number): void {
    this.squash = Math.min(0.28, 0.08 + intensity * 0.02);
  }
}
