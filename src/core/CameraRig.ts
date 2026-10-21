import * as THREE from 'three';
import { damp } from './math';
import { groundHeight } from '../world/terrain';

export type CamMode = 'title' | 'chase' | 'lookback' | 'orbit';

export interface CamFocus {
  pos: THREE.Vector3;
  heading: number;
  steer: number;
  speedN: number;
  boost: boolean;
  airborne: boolean;
}

/**
 * Third-person chase camera: sits behind and above the doctor, looks down the
 * fall line, swings with turns, rolls into carves and widens FOV with speed.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private yaw = Math.PI;
  private dist = 6;
  private height = 1.6;
  private roll = 0;
  private trauma = 0;
  private time = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 2600);
    this.camera.layers.enable(1);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Jump smoothing state straight to the focus (used on resets). */
  snap(f: CamFocus): void {
    this.target.copy(f.pos);
    this.look.copy(f.pos);
  }

  update(dt: number, mode: CamMode, f: CamFocus): void {
    this.time += dt;
    const p = f.pos;

    // Smooth the tracked point; tight on Z so speed reads as speed, looser vertically.
    this.target.x = damp(this.target.x, p.x, 10, dt);
    this.target.y = damp(this.target.y, p.y, f.airborne ? 4 : 7, dt);
    this.target.z = damp(this.target.z, p.z, 16, dt);

    let yaw: number;
    let dist: number;
    let height: number;
    let yawRate = 4;
    const lookAt = this.tmp;
    switch (mode) {
      case 'title':
        yaw = Math.PI + 0.55 + Math.sin(this.time * 0.35) * 0.25;
        dist = 6;
        height = 1.4;
        // Look past the doctor's left so he stands beside the title UI, not under it.
        lookAt.set(
          this.target.x - Math.cos(this.yaw) * 1.7,
          this.target.y + 1.5,
          this.target.z - Math.sin(this.yaw) * 1.7,
        );
        break;
      case 'orbit':
        yaw = this.yaw + dt * 0.7;
        yawRate = 100;
        dist = 5;
        height = 2.2;
        lookAt.set(this.target.x, this.target.y + 1, this.target.z);
        break;
      case 'lookback':
        yaw = f.heading + Math.PI;
        yawRate = 12;
        dist = 6.5;
        height = 2.6;
        lookAt.set(this.target.x - Math.sin(f.heading) * 10, this.target.y + 3.5, this.target.z + Math.cos(f.heading) * 10);
        break;
      default: {
        yaw = f.heading * 0.5;
        yawRate = 3.5;
        // High chase cam pitched ~50 deg down: doctor near the bottom, slope ahead in view.
        dist = 6.5 + f.speedN * 1.5;
        height = 13 + f.speedN * 1.5;
        const ahead = 6;
        lookAt.set(
          this.target.x + Math.sin(f.heading * 0.7) * ahead,
          this.target.y - ahead * 0.3,
          this.target.z - Math.cos(f.heading * 0.7) * ahead,
        );
      }
    }

    // Unwrap so the camera swings the short way round.
    while (yaw - this.yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw - this.yaw < -Math.PI) yaw += Math.PI * 2;
    this.yaw = damp(this.yaw, yaw, yawRate, dt);
    this.dist = damp(this.dist, dist, 3, dt);
    this.height = damp(this.height, height, 3, dt);
    this.look.x = damp(this.look.x, lookAt.x, 12, dt);
    this.look.y = damp(this.look.y, lookAt.y, 8, dt);
    this.look.z = damp(this.look.z, lookAt.z, 16, dt);

    const cam = this.camera;
    cam.position.set(
      this.target.x - Math.sin(this.yaw) * this.dist,
      this.target.y + this.height,
      this.target.z + Math.cos(this.yaw) * this.dist,
    );
    const floor = groundHeight(cam.position.x, cam.position.z) + 1.2;
    if (cam.position.y < floor) cam.position.y = floor;

    // Screen shake from trauma.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    cam.position.x += (Math.random() - 0.5) * s * 0.9;
    cam.position.y += (Math.random() - 0.5) * s * 0.9;
    cam.lookAt(this.look);

    const rollTarget = mode === 'chase' ? -f.steer * 0.06 : 0;
    this.roll = damp(this.roll, rollTarget, 5, dt);
    cam.rotateZ(this.roll + (Math.random() - 0.5) * s * 0.08);

    const fov = mode === 'chase' ? 60 + f.speedN * 18 + (f.boost ? 8 : 0) : 55;
    const newFov = damp(cam.fov, fov, 3, dt);
    if (Math.abs(newFov - cam.fov) > 0.01) {
      cam.fov = newFov;
      cam.updateProjectionMatrix();
    }
  }
}
