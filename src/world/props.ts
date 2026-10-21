/**
 * Procedural low-poly prop geometry. Every prop is merged into one
 * vertex-coloured BufferGeometry so each instance is a single draw call.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rampProfile } from './terrain';

type Vec3 = [number, number, number];

interface PartOpts {
  p?: Vec3;
  r?: Vec3;
  s?: Vec3;
}

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

/** Strip to position/normal, transform, and paint a flat vertex colour. */
function part(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, o: PartOpts = {}): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  tmpEuler.set(...(o.r ?? [0, 0, 0]));
  tmpQuat.setFromEuler(tmpEuler);
  tmpMatrix.compose(new THREE.Vector3(...(o.p ?? [0, 0, 0])), tmpQuat, new THREE.Vector3(...(o.s ?? [1, 1, 1])));
  g.applyMatrix4(tmpMatrix);
  tmpColor.set(color);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('Failed to merge prop geometry');
  g.computeBoundingSphere();
  return g;
}

/** Recolour vertices by a callback on their position/normal (snow caps etc). */
function recolor(
  g: THREE.BufferGeometry,
  fn: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void,
): THREE.BufferGeometry {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = g.attributes.color;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    fn(p, n, c);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

function pineTree(leaf: number, snowy: boolean): THREE.BufferGeometry {
  const snow = 0xf4f9ff;
  const parts = [part(new THREE.CylinderGeometry(0.28, 0.4, 1.6, 6), 0x7a4a2a, { p: [0, 0.8, 0] })];
  const tiers: [number, number, number][] = [
    [2.3, 2.6, 2.3],
    [1.75, 2.3, 3.7],
    [1.2, 2.0, 4.9],
  ];
  for (const [r, h, y] of tiers) {
    parts.push(part(new THREE.ConeGeometry(r, h, 7), leaf, { p: [0, y, 0], r: [0, Math.random() * 3, 0] }));
    if (snowy) parts.push(part(new THREE.ConeGeometry(r * 0.62, h * 0.42, 7), snow, { p: [0, y + h * 0.3, 0] }));
  }
  parts.push(part(new THREE.ConeGeometry(0.45, 0.7, 7), snow, { p: [0, 6.0, 0] }));
  return merge(parts);
}

function rock(seed: number): THREE.BufferGeometry {
  const g = part(new THREE.DodecahedronGeometry(1, 0), 0x7d8799);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  // Jitter by a hash of the vertex position so shared corners stay welded.
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 12.9 + v.y * 78.2 + v.z * 37.7 + seed * 11.3) * 43758.5;
    const j = 0.75 + (h - Math.floor(h)) * 0.5;
    pos.setXYZ(i, v.x * j * 1.2, v.y * j * 0.8 + 0.45, v.z * j);
  }
  g.computeVertexNormals();
  const snowCap = new THREE.Color(0xf4f9ff);
  return merge([
    recolor(g, (p, n, c) => {
      if (n.y > 0.55 && p.y > 0.6) c.copy(snowCap);
      else if (p.y < 0.4) c.multiplyScalar(0.8);
    }),
  ]);
}

function snowman(): THREE.BufferGeometry {
  const white = 0xf6faff;
  const coal = 0x1d1f26;
  const parts = [
    part(new THREE.IcosahedronGeometry(0.85, 1), white, { p: [0, 0.75, 0] }),
    part(new THREE.IcosahedronGeometry(0.62, 1), white, { p: [0, 1.85, 0] }),
    part(new THREE.IcosahedronGeometry(0.45, 1), white, { p: [0, 2.7, 0] }),
    // Carrot nose points uphill toward the approaching skier (+Z).
    part(new THREE.ConeGeometry(0.09, 0.55, 6), 0xff7a1a, { p: [0, 2.7, 0.62], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.IcosahedronGeometry(0.07, 0), coal, { p: [-0.16, 2.85, 0.38] }),
    part(new THREE.IcosahedronGeometry(0.07, 0), coal, { p: [0.16, 2.85, 0.38] }),
    part(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 8), coal, { p: [0, 3.25, 0], r: [0.1, 0, 0.15] }),
    part(new THREE.CylinderGeometry(0.48, 0.48, 0.05, 10), coal, { p: [0, 3.03, 0], r: [0.1, 0, 0.15] }),
    part(new THREE.CylinderGeometry(0.3, 0.3, 0.09, 8), 0xe8323c, { p: [0, 3.1, 0], r: [0.1, 0, 0.15] }),
    part(new THREE.CylinderGeometry(0.04, 0.03, 1.3, 4), 0x6b3f1f, { p: [-0.95, 2.1, 0], r: [0, 0, 1.0] }),
    part(new THREE.CylinderGeometry(0.04, 0.03, 1.3, 4), 0x6b3f1f, { p: [0.95, 2.3, 0], r: [0, 0, -1.3] }),
    part(new THREE.TorusGeometry(0.42, 0.09, 5, 10), 0xe8323c, { p: [0, 2.33, 0], r: [Math.PI / 2, 0, 0] }),
  ];
  for (let i = 0; i < 3; i++) parts.push(part(new THREE.IcosahedronGeometry(0.06, 0), coal, { p: [0, 1.6 + i * 0.25, 0.6] }));
  return merge(parts);
}

function log(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.5, 0.5, 6.5, 8), 0x8a5530, { r: [0, 0, Math.PI / 2], p: [0, 0.5, 0] }),
    part(new THREE.CylinderGeometry(0.42, 0.42, 6.55, 8), 0xd9a066, { r: [0, 0, Math.PI / 2], p: [0, 0.5, 0], s: [1, 1, 1] }),
    part(new THREE.BoxGeometry(6.2, 0.18, 0.6), 0xf4f9ff, { p: [0, 1.0, 0] }),
  ]);
}

function drift(): THREE.BufferGeometry {
  const g = part(new THREE.IcosahedronGeometry(1, 1), 0xeaf3ff, { s: [3, 0.8, 2.2] });
  return merge([recolor(g, (p, _n, c) => p.y < 0 && c.setHex(0xd2e2f5))]);
}

function marker(): THREE.BufferGeometry {
  const parts = [part(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5), 0x333844, { p: [0, 1.1, 0] })];
  for (let i = 0; i < 3; i++) {
    parts.push(part(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 5), 0xff6a13, { p: [0, 1.15 + i * 0.4, 0] }));
  }
  return merge(parts);
}

function flag(color: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(1.1, -0.35);
  shape.lineTo(0, -0.7);
  shape.lineTo(0, 0);
  return merge([
    part(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), 0x2b2f3a, { p: [0, 1.5, 0] }),
    part(new THREE.ShapeGeometry(shape), color, { p: [0, 3, 0] }),
  ]);
}

/** A curved snow kicker. Local origin at the uphill-centre of its base, extending to -Z. */
function ramp(len: number, w: number, h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    shape.lineTo(u * len, h * rampProfile(u));
  }
  shape.lineTo(len, 0);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  // Shape X -> world -Z, extrude depth -> world X.
  g.rotateY(Math.PI / 2);
  g.translate(-w / 2, 0, 0);
  const painted = part(g, 0xf8fbff);
  const stripe = new THREE.Color(0xff5a1f);
  const side = new THREE.Color(0xa9cbef);
  return merge([
    recolor(painted, (p, n, c) => {
      if (n.y < 0.4) c.copy(side);
      else if (Math.abs(Math.abs(p.x) - w / 2) < 0.6) c.copy(stripe);
    }),
  ]);
}

function coin(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.7, 0.7, 0.16, 14), 0xffc928, { r: [Math.PI / 2, 0, 0] }),
    part(new THREE.BoxGeometry(0.5, 0.16, 0.2), 0xff3b3b, { p: [0, 0, 0] }),
    part(new THREE.BoxGeometry(0.16, 0.5, 0.2), 0xff3b3b, { p: [0, 0, 0] }),
  ]);
}

function medkit(): THREE.BufferGeometry {
  const red = 0xf02d3a;
  return merge([
    part(new THREE.BoxGeometry(1.2, 0.85, 0.6), 0xffffff),
    part(new THREE.BoxGeometry(0.5, 0.14, 0.62), red, { p: [0, 0.05, 0] }),
    part(new THREE.BoxGeometry(0.14, 0.5, 0.62), red, { p: [0, 0.05, 0] }),
    part(new THREE.BoxGeometry(0.5, 0.12, 0.12), 0x444a55, { p: [0, 0.5, 0] }),
  ]);
}

function syringe(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 10), 0x2ff3c8),
    part(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 10), 0xeaf6ff, { p: [0, 0.6, 0] }),
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), 0xeaf6ff, { p: [0, 0.9, 0] }),
    part(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10), 0xeaf6ff, { p: [0, 1.2, 0] }),
    part(new THREE.CylinderGeometry(0.03, 0.01, 0.6, 5), 0xc9d3e0, { p: [0, -0.9, 0] }),
    part(new THREE.CylinderGeometry(0.12, 0.2, 0.15, 10), 0xc9d3e0, { p: [0, -0.65, 0] }),
  ]);
}

function mountain(seed: number): THREE.BufferGeometry {
  const g = part(new THREE.ConeGeometry(1, 1, 9, 3), 0x8ea7c9);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 9.1 + v.y * 41.7 + v.z * 17.3 + seed) * 43758.5;
    const j = (h - Math.floor(h) - 0.5) * 0.18;
    if (v.y < 0.49) pos.setXYZ(i, v.x * (1 + j), v.y + j * 0.5, v.z * (1 + j));
  }
  g.translate(0, 0.5, 0);
  g.computeVertexNormals();
  const snow = new THREE.Color(0xf6faff);
  const lo = new THREE.Color(0x7b93b8);
  return merge([recolor(g, (p, _n, c) => (p.y > 0.55 + Math.sin(p.x * 13) * 0.06 ? c.copy(snow) : c.lerpColors(lo, c, p.y)))]);
}

export const RAMP_DIMS = { len: 9, w: 12, h: 2.7 };

export const geos = {
  trees: [pineTree(0x1f8a52, false), pineTree(0x17734a, true), pineTree(0x2a9d6a, true), pineTree(0x126144, true)],
  rocks: [rock(1), rock(2), rock(3)],
  snowman: snowman(),
  log: log(),
  drift: drift(),
  marker: marker(),
  flag: flag(0xff3b3b),
  flagAlt: flag(0xffd21f),
  ramp: ramp(RAMP_DIMS.len, RAMP_DIMS.w, RAMP_DIMS.h),
  coin: coin(),
  medkit: medkit(),
  syringe: syringe(),
  mountains: [mountain(1), mountain(2), mountain(3)],
};

export const mats = {
  prop: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
  terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
  coin: new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.45,
    roughness: 0.35,
    emissive: 0x4a3200,
    flatShading: true,
  }),
  pickup: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x303030 }),
  mountain: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false }),
};
