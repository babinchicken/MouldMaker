import * as THREE from 'three'
import type { Manifold } from 'manifold-3d'

/**
 * Parses binary or ASCII STL into a non-indexed BufferGeometry.
 *
 * Written here rather than pulled from three's STLLoader so the worker doesn't
 * have to reach into three/examples, and so a malformed header (the usual reason
 * a "binary" STL is really ASCII) is detected by triangle count rather than by
 * sniffing for the word "solid", which plenty of binary files contain too.
 */
export function parseStl(buffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(buffer)
  if (buffer.byteLength >= 84) {
    const triangles = view.getUint32(80, true)
    if (84 + triangles * 50 === buffer.byteLength) return parseBinaryStl(view, triangles)
  }
  return parseAsciiStl(new TextDecoder().decode(buffer))
}

function parseBinaryStl(view: DataView, triangles: number): THREE.BufferGeometry {
  const positions = new Float32Array(triangles * 9)
  for (let t = 0; t < triangles; t++) {
    const record = 84 + t * 50
    for (let corner = 0; corner < 3; corner++) {
      const at = record + 12 + corner * 12
      positions[t * 9 + corner * 3] = view.getFloat32(at, true)
      positions[t * 9 + corner * 3 + 1] = view.getFloat32(at + 4, true)
      positions[t * 9 + corner * 3 + 2] = view.getFloat32(at + 8, true)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

function parseAsciiStl(text: string): THREE.BufferGeometry {
  const positions: number[] = []
  const vertex = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g
  let match: RegExpExecArray | null
  while ((match = vertex.exec(text)) !== null) {
    positions.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]))
  }
  if (positions.length === 0) throw new Error('No triangles found — is this really an STL?')
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

/** Flat triangle list, ready for either STL writing or a preview mesh. */
export interface TriangleSoup {
  positions: Float32Array
}

export function manifoldToSoup(part: Manifold): TriangleSoup {
  const mesh = part.getMesh()
  const { vertProperties, triVerts, numProp } = mesh
  const positions = new Float32Array(triVerts.length * 3)
  for (let i = 0; i < triVerts.length; i++) {
    const v = triVerts[i] * numProp
    positions[i * 3] = vertProperties[v]
    positions[i * 3 + 1] = vertProperties[v + 1]
    positions[i * 3 + 2] = vertProperties[v + 2]
  }
  return { positions }
}

/**
 * Concatenates several triangle soups into one binary STL.
 *
 * Overlapping closed solids in a single file are deliberate: slicers union them,
 * which is how the master, its plinth and its support boss can ship as one
 * printable file without ever running a boolean over a downloaded STL that may
 * well not be manifold enough to survive one.
 */
export function writeBinaryStl(soups: TriangleSoup[]): ArrayBuffer {
  const triangles = soups.reduce((n, s) => n + s.positions.length / 9, 0)
  const buffer = new ArrayBuffer(84 + triangles * 50)
  const view = new DataView(buffer)
  view.setUint32(80, triangles, true)

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()

  let t = 0
  for (const soup of soups) {
    const p = soup.positions
    for (let i = 0; i < p.length; i += 9) {
      a.set(p[i], p[i + 1], p[i + 2])
      b.set(p[i + 3], p[i + 4], p[i + 5])
      c.set(p[i + 6], p[i + 7], p[i + 8])
      normal.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()

      const record = 84 + t * 50
      view.setFloat32(record, normal.x, true)
      view.setFloat32(record + 4, normal.y, true)
      view.setFloat32(record + 8, normal.z, true)
      for (let corner = 0; corner < 3; corner++) {
        const at = record + 12 + corner * 12
        view.setFloat32(at, p[i + corner * 3], true)
        view.setFloat32(at + 4, p[i + corner * 3 + 1], true)
        view.setFloat32(at + 8, p[i + corner * 3 + 2], true)
      }
      t++
    }
  }
  return buffer
}

/** Axis-aligned box as a triangle soup, for the plinth and the support boss. */
export function boxSoup(min: THREE.Vector3, max: THREE.Vector3): TriangleSoup {
  const box = new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z)
  box.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
  const nonIndexed = box.toNonIndexed()
  return { positions: nonIndexed.getAttribute('position').array as Float32Array }
}
