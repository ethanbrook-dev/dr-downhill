import * as THREE from 'three';
import { Chunk, type Obstacle, type Pickup } from './Chunk';
import { CHUNK_LEN, resetFeatureCache } from './terrain';
import { geos, mats } from './props';

const CHUNKS_BEHIND = 2;
const CHUNKS_AHEAD = 6;

/** Endless terrain: a fixed pool of chunks recycled from behind to the front. */
export class World {
  private readonly chunks: Chunk[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < CHUNKS_BEHIND + CHUNKS_AHEAD + 1; i++) this.chunks.push(new Chunk(scene));
  }

  reset(): void {
    resetFeatureCache();
    this.chunks.forEach((c, i) => c.build(i - CHUNKS_BEHIND));
  }

  update(playerZ: number, dt: number, time: number): void {
    const current = Math.floor(-playerZ / CHUNK_LEN);
    let maxIndex = Math.max(...this.chunks.map((c) => c.index));
    for (const c of this.chunks) {
      if (c.index < current - CHUNKS_BEHIND) c.build(++maxIndex);
    }
    for (const c of this.chunks) c.animate(dt, time);
  }

  private chunkAt(index: number): Chunk | undefined {
    return this.chunks.find((c) => c.index === index);
  }

  /** Visit obstacles in the chunk containing z and its neighbours. */
  forObstaclesNear(z: number, fn: (o: Obstacle) => void): void {
    const idx = Math.floor(-z / CHUNK_LEN);
    for (let i = idx - 1; i <= idx + 1; i++) {
      const c = this.chunkAt(i);
      if (c) for (const o of c.obstacles) if (o.alive && Math.abs(o.z - z) < 8) fn(o);
    }
  }

  forPickupsNear(z: number, fn: (p: Pickup) => void): void {
    const idx = Math.floor(-z / CHUNK_LEN);
    for (let i = idx - 1; i <= idx + 1; i++) {
      const c = this.chunkAt(i);
      if (c) for (const p of c.pickups) if (!p.taken && Math.abs(p.z - z) < 4) fn(p);
    }
  }
}

/** Gradient sky dome with a soft sun glow; follows the camera. */
export class Sky {
  readonly mesh: THREE.Mesh;

  constructor(sunDir: THREE.Vector3) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x2f7fe0) },
        uHorizon: { value: new THREE.Color(0xd6ecff) },
        uSun: { value: sunDir.clone().normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSun;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 1.6 + 0.08, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.7));
          float s = max(dot(vDir, uSun), 0.0);
          col += vec3(1.0, 0.9, 0.7) * (pow(s, 400.0) * 1.5 + pow(s, 12.0) * 0.25);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}

/** Ring of distant peaks that stay on the horizon as you descend. */
export class Mountains {
  readonly group = new THREE.Group();

  constructor() {
    const count = 34;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.1;
      const dist = 900 + Math.random() * 400;
      const m = new THREE.Mesh(geos.mountains[i % geos.mountains.length], mats.mountain);
      const h = 260 + Math.random() * 380;
      m.scale.set(h * (0.9 + Math.random() * 0.8), h, h * (0.9 + Math.random() * 0.8));
      m.position.set(Math.sin(a) * dist, 0, -Math.cos(a) * dist);
      m.rotation.y = Math.random() * Math.PI;
      this.group.add(m);
    }
  }

  update(camera: THREE.Camera): void {
    this.group.position.set(camera.position.x, camera.position.y - 220, camera.position.z);
  }
}
