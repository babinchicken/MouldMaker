// A dense figure at a caller-chosen scale, standing in for an AI-generated export.
import * as THREE from 'three'
import { writeFileSync } from 'node:fs'

const [outFile, targetHeight, density] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4] ?? 1)]
const soups = []
const push = (g) => soups.push((g.index ? g.toNonIndexed() : g).getAttribute('position').array)

const seg = (n) => Math.max(8, Math.round(n * density))
const profile = [
  [0,0],[26,0],[30,6],[28,16],[22,26],[17,38],[15,50],[17,58],[14,63],[7,66],[0,67],
].map(([x,y]) => new THREE.Vector2(x,y))
push(new THREE.LatheGeometry(profile, seg(360)))
const head = new THREE.SphereGeometry(11, seg(220), seg(160)); head.translate(0,0,74); push(head)
const knot = new THREE.SphereGeometry(4.5, seg(120), seg(90)); knot.translate(0,0,85); push(knot)
for (const dx of [-19, 19]) { const k = new THREE.SphereGeometry(10, seg(180), seg(130)); k.translate(dx,12,9); push(k) }

const rot = new THREE.Matrix4().makeRotationX(Math.PI/2)
const v = new THREE.Vector3()
const all = soups.map((p, idx) => {
  const out = new Float32Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i+1], p[i+2]); if (idx === 0) v.applyMatrix4(rot)
    out[i]=v.x; out[i+1]=v.y; out[i+2]=v.z
  }
  return out
})

// Rescale so the figure stands `targetHeight` units tall, mimicking exporters that
// normalise to a unit cube or work in metres.
let lo = Infinity, hi = -Infinity
for (const p of all) for (let i = 2; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]) }
const k = targetHeight / (hi - lo)
for (const p of all) for (let i = 0; i < p.length; i++) p[i] *= k

const tris = all.reduce((n,p) => n + p.length/9, 0)
const buf = new ArrayBuffer(84 + tris*50), view = new DataView(buf)
view.setUint32(80, tris, true)
let t = 0
const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3(), n=new THREE.Vector3()
for (const p of all) for (let i = 0; i < p.length; i += 9) {
  a.set(p[i],p[i+1],p[i+2]); b.set(p[i+3],p[i+4],p[i+5]); c.set(p[i+6],p[i+7],p[i+8])
  n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
  const r = 84 + t*50
  view.setFloat32(r,n.x,true); view.setFloat32(r+4,n.y,true); view.setFloat32(r+8,n.z,true)
  for (let j=0;j<3;j++){ view.setFloat32(r+12+j*12,p[i+j*3],true); view.setFloat32(r+16+j*12,p[i+j*3+1],true); view.setFloat32(r+20+j*12,p[i+j*3+2],true) }
  t++
}
writeFileSync(outFile, Buffer.from(buf))
console.log(`${outFile}: ${tris.toLocaleString()} triangles, ${targetHeight} units tall, ${(buf.byteLength/1048576).toFixed(1)} MB`)
