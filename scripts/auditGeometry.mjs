// Measures the generated kit against what it claims to be: a closed jacket that
// stands off the master by exactly the silicone thickness.
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { readFileSync } from 'node:fs'

const SCRATCH = process.env.SCRATCH

function readStl(file) {
  const raw = readFileSync(file)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const tris = view.getUint32(80, true)
  const positions = new Float32Array(tris * 9)
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const at = 84 + t * 50 + 12 + k * 12
      positions[t * 9 + k * 3] = view.getFloat32(at, true)
      positions[t * 9 + k * 3 + 1] = view.getFloat32(at + 4, true)
      positions[t * 9 + k * 3 + 2] = view.getFloat32(at + 8, true)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return g
}

function closedness(geometry) {
  const p = geometry.getAttribute('position').array
  const key = (i) => `${p[i].toFixed(5)},${p[i+1].toFixed(5)},${p[i+2].toFixed(5)}`
  const ids = new Map(); const canon = []
  for (let i = 0; i < p.length; i += 3) {
    const k = key(i)
    if (!ids.has(k)) ids.set(k, ids.size)
    canon.push(ids.get(k))
  }
  const edges = new Map(); let volume = 0, degenerate = 0
  for (let t = 0; t < canon.length; t += 3) {
    const [a, b, c] = [canon[t], canon[t+1], canon[t+2]]
    if (a === b || b === c || a === c) { degenerate++; continue }
    for (const [u, v] of [[a,b],[b,c],[c,a]]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
    const i = t * 3
    volume += (p[i]*(p[i+4]*p[i+8]-p[i+5]*p[i+7]) - p[i+1]*(p[i+3]*p[i+8]-p[i+5]*p[i+6]) + p[i+2]*(p[i+3]*p[i+7]-p[i+4]*p[i+6])) / 6
  }
  let boundary = 0, nonManifold = 0
  for (const n of edges.values()) { if (n === 1) boundary++; else if (n !== 2) nonManifold++ }
  return { boundary, nonManifold, degenerate, volume }
}

// Measure against the statue alone: the jacket is *supposed* to touch the plinth,
// so including it would mask a real collision with the model. Place it exactly as
// the pipeline does — scaled to the target height first, then stood on the plinth.
// Skipping the scale silently compares against a differently-sized statue and every
// standoff reading comes out wrong.
const TARGET_HEIGHT_MM = 100
const PLINTH_HEIGHT_MM = 6
const statue = readStl(`${SCRATCH}/test-buddha.stl`)
{
  statue.computeBoundingBox()
  const raw = statue.boundingBox
  const scale = TARGET_HEIGHT_MM / (raw.max.z - raw.min.z)
  statue.scale(scale, scale, scale)
  statue.computeBoundingBox()
  const b = statue.boundingBox
  statue.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z + PLINTH_HEIGHT_MM)
}
const master = readStl(`${SCRATCH}/master-with-base.stl`)
const front = readStl(`${SCRATCH}/jacket-front.stl`)
const back = readStl(`${SCRATCH}/jacket-back.stl`)

console.log('── Closedness (position-welded) ──')
for (const [name, g] of [['master-with-base', master], ['jacket-front', front], ['jacket-back', back]]) {
  const r = closedness(g)
  const verdict = name.startsWith('jacket') ? (r.boundary === 0 && r.nonManifold === 0 ? 'CLOSED' : 'OPEN') : '(soup of solids, seams expected)'
  console.log(`  ${name.padEnd(18)} boundary=${String(r.boundary).padStart(5)} nonManifold=${String(r.nonManifold).padStart(3)} vol=${(r.volume/1000).toFixed(1)}ml  ${verdict}`)
}

// Distance from every jacket vertex to the master surface: the inner face should
// sit at the silicone thickness, the outer face one jacket wall beyond it.
const bvh = new MeshBVH(statue)
const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
const v = new THREE.Vector3()

console.log('\n── Jacket standoff from master (mm) ──')
for (const [name, g] of [['jacket-front', front], ['jacket-back', back]]) {
  const p = g.getAttribute('position').array
  let min = Infinity, near3 = 0, near6 = 0, total = 0, tooClose = 0
  const minAt = new THREE.Vector3()
  const hist = new Map()
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i+1], p[i+2])
    if (!bvh.closestPointToPoint(v, target, 0, 40)) continue
    const d = target.distance
    if (d < min) { min = d; minAt.copy(v) }
    if (d < 2.5) tooClose++
    total++
    if (Math.abs(d - 3) < 0.35) near3++
    if (Math.abs(d - 6) < 0.35) near6++
    const bucket = Math.floor(d)
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1)
  }
  console.log(`  ${name}: closest approach ${min.toFixed(2)}mm at (${minAt.x.toFixed(1)}, ${minAt.y.toFixed(1)}, ${minAt.z.toFixed(1)}) | ${(100*near3/total).toFixed(0)}% of vertices at 3±0.35 (inner face), ${(100*near6/total).toFixed(0)}% at 6±0.35 (outer face)`)
  console.log(`    vertices closer than 2.5mm: ${tooClose} of ${total}`)
  const top = [...hist.entries()].sort((a,b) => b[1]-a[1]).slice(0,5).map(([b,n]) => `${b}-${b+1}mm:${(100*n/total).toFixed(0)}%`)
  console.log(`    distance histogram: ${top.join('  ')}`)
}

console.log('\n── Extents (mm) ──')
for (const [name, g] of [['master-with-base', master], ['jacket-front', front], ['jacket-back', back]]) {
  g.computeBoundingBox()
  const { min, max } = g.boundingBox
  console.log(`  ${name.padEnd(18)} x[${min.x.toFixed(1)}, ${max.x.toFixed(1)}]  y[${min.y.toFixed(1)}, ${max.y.toFixed(1)}]  z[${min.z.toFixed(1)}, ${max.z.toFixed(1)}]`)
}
