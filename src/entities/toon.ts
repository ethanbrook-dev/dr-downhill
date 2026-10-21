import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  gradient = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

/** Cached cel-shaded material. */
export function toon(color: THREE.ColorRepresentation, opts: { emissive?: number; map?: THREE.Texture; side?: THREE.Side } = {}): THREE.MeshToonMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${opts.emissive ?? 0}|${opts.map?.uuid ?? ''}|${opts.side ?? 0}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: gradientMap(),
      emissive: opts.emissive ?? 0x000000,
      map: opts.map ?? null,
      side: opts.side ?? THREE.FrontSide,
    });
    cache.set(key, m);
  }
  return m;
}

/** Create a shadow-casting mesh and add it to a parent. */
export function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function pivot(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
