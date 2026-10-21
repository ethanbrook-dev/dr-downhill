import * as THREE from 'three';

/** CPU-simulated soft round particles (snow spray, impacts, confetti). */
export class Particles {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
          vColor = color;
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.12, d));
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Pixels-per-world-unit factor; call on resize or FOV change. */
  setScale(viewportHeightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color: THREE.Color,
    gravity = 9,
    drag = 1.5,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  burst(at: THREE.Vector3, count: number, speed: number, colors: THREE.Color[], size = 0.35, life = 1, gravity = 12): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(
        at.x,
        at.y,
        at.z,
        Math.cos(a) * r * s,
        Math.abs(u) * s + speed * 0.3,
        Math.sin(a) * r * s,
        life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.8),
        colors[i % colors.length],
        gravity,
        1.2,
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = Math.min(1, t * 2.5) * 0.95;
      this.size[i] = this.baseSize[i] * (1.4 - t * 0.4);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}

function softDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Ambient snowfall in a box that wraps around the camera. */
export class SnowFall {
  readonly points: THREE.Points;
  private readonly offsets: Float32Array;
  private readonly box = new THREE.Vector3(90, 40, 110);
  private t = 0;

  constructor(count = 1800) {
    this.offsets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.offsets[i * 3] = Math.random() * this.box.x;
      this.offsets[i * 3 + 1] = Math.random() * this.box.y;
      this.offsets[i * 3 + 2] = Math.random() * this.box.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.32,
        map: softDot(),
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
        color: 0xffffff,
      }),
    );
    this.points.frustumCulled = false;
  }

  update(dt: number, center: THREE.Vector3): void {
    this.t += dt;
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const o = this.offsets;
    const { x: bx, y: by, z: bz } = this.box;
    const wind = Math.sin(this.t * 0.3) * 1.5;
    for (let i = 0; i < pos.count; i++) {
      o[i * 3] += (wind + Math.sin(this.t + i) * 0.4) * dt;
      o[i * 3 + 1] -= (2.2 + (i % 5) * 0.3) * dt;
      // Wrap each flake into a box centred on the camera so it streams past at speed.
      const x = (((o[i * 3] - center.x) % bx) + bx) % bx;
      const y = (((o[i * 3 + 1] - center.y) % by) + by) % by;
      const z = (((o[i * 3 + 2] - center.z) % bz) + bz) % bz;
      pos.setXYZ(i, center.x + x - bx / 2, center.y + y - by / 2, center.z + z - bz * 0.75);
    }
    pos.needsUpdate = true;
  }
}

/** Streaks that rush past the camera at high speed. Lives on layer 1 so the rear cam ignores it. */
export class SpeedLines {
  readonly lines: THREE.LineSegments;
  private readonly data: { a: number; r: number; z: number; len: number }[] = [];
  private readonly material: THREE.LineBasicMaterial;

  constructor(count = 70) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.layers.set(1);
    for (let i = 0; i < count; i++) this.data.push(this.fresh(-Math.random() * 40));
  }

  private fresh(z = -40): { a: number; r: number; z: number; len: number } {
    return { a: Math.random() * Math.PI * 2, r: 2.5 + Math.random() * 5, z, len: 2 + Math.random() * 3 };
  }

  update(dt: number, intensity: number, speed: number): void {
    this.material.opacity = intensity * 0.55;
    this.lines.visible = intensity > 0.01;
    if (!this.lines.visible) return;
    const pos = this.lines.geometry.attributes.position as THREE.BufferAttribute;
    this.data.forEach((d, i) => {
      d.z += speed * 1.4 * dt;
      if (d.z > 0) Object.assign(d, this.fresh());
      const x = Math.cos(d.a) * d.r;
      const y = Math.sin(d.a) * d.r * 0.7;
      const len = d.len * (0.5 + intensity);
      pos.setXYZ(i * 2, x, y, d.z);
      pos.setXYZ(i * 2 + 1, x, y, d.z - len);
    });
    pos.needsUpdate = true;
  }
}
