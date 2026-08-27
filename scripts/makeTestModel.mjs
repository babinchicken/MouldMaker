// Generates a Buddha-ish test master: a lathed seated body, a head, and two knee
// bulges that create genuine undercuts along both horizontal axes.
import * as THREE from 'three'
import { writeFileSync } from 'node:fs'

const soups = []
const push = (geometry) => {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  soups.push(g.getAttribute('position').array)
}

// Seated body: wide lap tapering to shoulders.
const profile = [
  [0, 0], [26, 0], [30, 6], [28, 16], [22, 26], [17, 38], [15, 50], [17, 58],
  [14, 63], [7, 66], [0, 67],
].map(([x, y]) => new THREE.Vector2(x, y))
push(new THREE.LatheGeometry(profile, 64))

// Head.
const head = new THREE.SphereGeometry(11, 40, 28)
head.translate(0, 0, 74)
push(head)

// Topknot.
const knot = new THREE.SphereGeometry(4.5, 24, 16)
knot.translate(0, 0, 85)
push(knot)

// Knees — the undercuts.
for (const dx of [-19, 19]) {
  const knee = new THREE.SphereGeometry(10, 28, 20)
  knee.translate(dx, 12, 9)
  push(knee)
}

// Lathe builds around Y; stand the whole thing up on Z.
const rotate = new THREE.Matrix4().makeRotationX(Math.PI / 2)
const all = []
for (const positions of soups) {
  const v = new THREE.Vector3()
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    v.set(positions[i], positions[i + 1], positions[i + 2])
    if (positions === soups[0]) v.applyMatrix4(rotate)
    out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z
  }
  all.push(out)
}

const triangles = all.reduce((n, p) => n + p.length / 9, 0)
const buffer = new ArrayBuffer(84 + triangles * 50)
const view = new DataView(buffer)
view.setUint32(80, triangles, true)
let t = 0
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3()
for (const p of all) {
  for (let i = 0; i < p.length; i += 9) {
    a.set(p[i], p[i+1], p[i+2]); b.set(p[i+3], p[i+4], p[i+5]); c.set(p[i+6], p[i+7], p[i+8])
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    const r = 84 + t * 50
    view.setFloat32(r, n.x, true); view.setFloat32(r+4, n.y, true); view.setFloat32(r+8, n.z, true)
    for (let k = 0; k < 3; k++) {
      view.setFloat32(r+12+k*12, p[i+k*3], true)
      view.setFloat32(r+16+k*12, p[i+k*3+1], true)
      view.setFloat32(r+20+k*12, p[i+k*3+2], true)
    }
    t++
  }
}
writeFileSync(process.argv[2] ?? 'test-buddha.stl', Buffer.from(buffer))
console.log(`wrote ${triangles} triangles`)
