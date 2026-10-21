import * as THREE from 'three';
import { damp } from '../core/math';
import { add, pivot, toon } from './toon';

export type ClownKind = 'skier' | 'runner';

export interface ClownPalette {
  suit: string;
  dots: string;
  hair: number;
  accent: number;
}

export const CLOWN_PALETTES: ClownPalette[] = [
  { suit: '#ff3da5', dots: '#ffe14a', hair: 0x33d17a, accent: 0x3a7bff },
  { suit: '#3a7bff', dots: '#ffffff', hair: 0xff6a00, accent: 0xff3da5 },
  { suit: '#9b3dff', dots: '#3dffa8', hair: 0xff2b2b, accent: 0xffd21f },
  { suit: '#ffc21f', dots: '#ff2b6b', hair: 0x2bc8ff, accent: 0x9b3dff },
  { suit: '#20c997', dots: '#ff5ad1', hair: 0xffe14a, accent: 0xff6a00 },
];

const dotTextures = new Map<string, THREE.CanvasTexture>();
function polkaDots(base: string, dots: string): THREE.CanvasTexture {
  const key = base + dots;
  let tex = dotTextures.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = dots;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.beginPath();
      g.arc(x * 32 + (y % 2) * 16 + 8, y * 32 + 16, 7, 0, Math.PI * 2);
      g.fill();
    }
  }
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  dotTextures.set(key, tex);
  return tex;
}

/** How the clown moves: reaching chase, silly wandering walk, or wobbly hazard skiing. */
export type ClownStyle = 'chase' | 'walk' | 'ski';

export interface ClownPose {
  style: ClownStyle;
  /** Running gait phase in radians. */
  phase: number;
  steer: number;
  /** Stumble spin progress, 0 when upright. */
  tumble: number;
  grabbing: boolean;
  lunge: number;
}

/** A creepy-funny clown. Faces -Z. */
export class ClownModel {
  readonly root = new THREE.Group();
  private readonly rig: THREE.Group;
  private readonly body: THREE.Group;
  private readonly head: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly rageEyes: THREE.Mesh[] = [];
  private readonly baseScale: number;
  private time = Math.random() * 10;
  private lean = 0;
  private enraged = false;

  constructor(readonly kind: ClownKind, palette: ClownPalette, scale = 1) {
    this.baseScale = scale;
    this.root.scale.setScalar(scale);
    const suit = toon(0xffffff, { map: polkaDots(palette.suit, palette.dots) });
    const plain = toon(palette.suit);
    const shoe = toon(0xe8202f);
    const white = toon(0xfffaf4);

    this.rig = pivot(this.root);
    if (kind === 'skier') {
      for (const x of [-0.2, 0.2]) {
        add(this.rig, new THREE.BoxGeometry(0.17, 0.05, 2.0), toon(palette.accent), x, 0.03, 0);
        add(this.rig, new THREE.BoxGeometry(0.17, 0.05, 0.36), toon(palette.accent), x, 0.1, -1.1).rotation.x = 0.6;
      }
    }

    // Legs with enormous shoes.
    const legY = kind === 'skier' ? 0.75 : 0.85;
    this.legL = pivot(this.rig, -0.17, legY, 0);
    this.legR = pivot(this.rig, 0.17, legY, 0);
    for (const leg of [this.legL, this.legR]) {
      add(leg, new THREE.CylinderGeometry(0.13, 0.17, legY - 0.12, 8), suit, 0, -(legY - 0.12) / 2, 0);
      add(leg, new THREE.SphereGeometry(0.2, 10, 8), shoe, 0, -legY + 0.1, -0.16).scale.set(0.95, 0.6, 1.7);
    }

    this.body = pivot(this.rig, 0, legY, 0);
    add(this.body, new THREE.SphereGeometry(0.42, 14, 10), suit, 0, 0.36, 0).scale.set(1, 1.15, 0.85);
    // Pom-pom buttons.
    for (let i = 0; i < 3; i++) add(this.body, new THREE.SphereGeometry(0.06, 8, 6), toon(palette.accent), 0, 0.55 - i * 0.18, -0.36 + i * 0.01);
    // Ruffled collar of alternating puffs.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      add(this.body, new THREE.SphereGeometry(0.1, 7, 5), i % 2 ? white : toon(palette.accent), Math.sin(a) * 0.27, 0.8, Math.cos(a) * 0.24);
    }

    this.head = pivot(this.body, 0, 0.88, 0);
    this.buildHead(palette, white);

    this.armL = pivot(this.body, -0.4, 0.62, 0);
    this.armR = pivot(this.body, 0.4, 0.62, 0);
    for (const arm of [this.armL, this.armR]) {
      add(arm, new THREE.CylinderGeometry(0.09, 0.12, 0.6, 8), plain, 0, -0.3, 0);
      add(arm, new THREE.SphereGeometry(0.13, 10, 8), white, 0, -0.64, 0).scale.set(1, 1.1, 0.8);
      for (let f = -1; f <= 1; f++) add(arm, new THREE.CylinderGeometry(0.03, 0.03, 0.14, 5), white, f * 0.06, -0.78, 0);
    }
    this.root.traverse((o) => (o.castShadow = true));
  }

  private buildHead(palette: ClownPalette, white: THREE.Material): void {
    const h = this.head;
    add(h, new THREE.SphereGeometry(0.27, 16, 12), white, 0, 0.2, 0);
    add(h, new THREE.SphereGeometry(0.09, 10, 8), toon(0xff1a1a, { emissive: 0x550000 }), 0, 0.18, -0.29);

    // Wild hair puffs on each side and the back.
    const hair = toon(palette.hair);
    for (const s of [-1, 1]) {
      add(h, new THREE.IcosahedronGeometry(0.17, 1), hair, s * 0.3, 0.27, 0.04);
      add(h, new THREE.IcosahedronGeometry(0.14, 1), hair, s * 0.33, 0.1, 0.1);
      add(h, new THREE.IcosahedronGeometry(0.12, 1), hair, s * 0.24, 0.4, 0.1);
    }
    add(h, new THREE.IcosahedronGeometry(0.16, 1), hair, 0, 0.3, 0.2);

    // Tiny tilted party hat.
    const hat = pivot(h, 0.06, 0.45, 0);
    hat.rotation.z = -0.3;
    add(hat, new THREE.ConeGeometry(0.11, 0.3, 10), toon(palette.accent), 0, 0.12, 0);
    add(hat, new THREE.SphereGeometry(0.05, 6, 5), toon(0xffe14a), 0, 0.29, 0);

    // Unblinking eyes with diamond makeup.
    const black = toon(0x101014);
    for (const s of [-1, 1]) {
      add(h, new THREE.SphereGeometry(0.07, 10, 8), toon(0xffffff), s * 0.1, 0.3, -0.22);
      add(h, new THREE.SphereGeometry(0.03, 6, 5), black, s * 0.09, 0.3, -0.285);
      // Glowing red eyes, only shown once the main clown is enraged.
      const glow = add(h, new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff1a1a }), s * 0.1, 0.3, -0.225);
      glow.visible = false;
      glow.castShadow = false;
      this.rageEyes.push(glow);
      add(h, new THREE.OctahedronGeometry(0.07, 0), toon(0x2a2aa8), s * 0.1, 0.42, -0.215).scale.set(0.5, 1.4, 0.3);
      add(h, new THREE.OctahedronGeometry(0.07, 0), toon(0x2a2aa8), s * 0.1, 0.18, -0.235).scale.set(0.5, 1.3, 0.3);
      add(h, new THREE.BoxGeometry(0.14, 0.03, 0.03), black, s * 0.1, 0.4, -0.235).rotation.z = s * 0.45;
    }

    // Huge grin with jagged teeth.
    const grin = add(h, new THREE.TorusGeometry(0.15, 0.04, 6, 14, Math.PI), toon(0xd01030), 0, 0.12, -0.21);
    grin.rotation.z = Math.PI;
    grin.rotation.x = 0.25;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + 0.35 + (i / 4) * (Math.PI - 0.7);
      add(h, new THREE.ConeGeometry(0.022, 0.06, 4), toon(0xffffee), Math.cos(a) * 0.13, 0.12 + Math.sin(a) * 0.13 + 0.03, -0.25).rotation.z = Math.PI;
    }
  }

  /** Enraged look: bigger, glowing red eyes. */
  setEnraged(on: boolean): void {
    this.enraged = on;
    for (const e of this.rageEyes) e.visible = on;
  }

  update(dt: number, p: ClownPose): void {
    this.time += dt;
    const t = this.time;
    const s = Math.sin(p.phase);

    const pulse = this.enraged ? 1.18 + Math.sin(t * 14) * 0.03 : 1;
    this.root.scale.setScalar(damp(this.root.scale.x, this.baseScale * pulse, 4, dt));

    if (this.kind === 'runner') {
      const stride = p.style === 'walk' ? 0.55 : 0.95;
      this.legL.rotation.x = s * stride;
      this.legR.rotation.x = -s * stride;
      this.rig.position.y = Math.abs(Math.cos(p.phase)) * (p.style === 'walk' ? 0.08 : 0.18);
      this.body.rotation.x = p.style === 'walk' ? 0.05 : -0.25 - p.lunge * 0.4;
    } else {
      this.legL.rotation.x = 0.35;
      this.legR.rotation.x = 0.35;
      this.rig.position.y = -0.08;
      this.body.rotation.x = p.style === 'ski' ? -0.15 + Math.sin(t * 5) * 0.12 : -0.45 - p.lunge * 0.3;
    }

    this.lean = damp(this.lean, -p.steer * 0.35 + (p.style === 'ski' ? Math.sin(t * 4.5) * 0.3 : 0), 6, dt);
    this.rig.rotation.z = this.lean;
    this.rig.rotation.x = -p.tumble;

    if (p.style === 'walk') {
      // Goofy arm swing with hands waving.
      this.armL.rotation.x = -s * 0.7;
      this.armR.rotation.x = s * 0.7;
      this.armL.rotation.z = -0.35 - Math.max(0, Math.sin(t * 3)) * 1.6;
      this.armR.rotation.z = 0.35;
    } else if (p.style === 'ski') {
      // Windmilling arms: a clown who never learned to ski.
      this.armL.rotation.x = t * 9;
      this.armR.rotation.x = t * 9 + Math.PI;
      this.armL.rotation.z = -0.5;
      this.armR.rotation.z = 0.5;
    } else {
      // Grabby arms reaching forward with wiggling fingers.
      const reach = p.grabbing ? 1.9 : 1.35 + p.lunge * 0.4;
      const wiggle = this.kind === 'runner' ? -s * 0.45 : Math.sin(t * 9) * 0.2;
      this.armL.rotation.x = reach + wiggle;
      this.armR.rotation.x = reach - wiggle;
      this.armL.rotation.z = p.grabbing ? 0.55 : -0.15 + Math.sin(t * 7) * 0.08;
      this.armR.rotation.z = p.grabbing ? -0.55 : 0.15 - Math.sin(t * 7.5) * 0.08;
    }

    // Creepy head tilt.
    this.head.rotation.z = Math.sin(t * (this.enraged ? 6 : 1.7)) * 0.3;
    this.head.rotation.y = Math.sin(t * 0.9) * 0.15;
  }
}
