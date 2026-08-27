import { buildMould } from '../src/mould/pipeline.ts'
import { DEFAULT_PARAMS } from '../src/mould/params.ts'
import { auditBores, auditHalves } from './probe.mjs'
import { auditBase } from './probeBase.mjs'
import { manifoldRuntime } from '../src/mould/manifoldRuntime.ts'

const toArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)

export async function runCheck(fileBuffer, write) {
  const buf = toArrayBuffer(fileBuffer)
  const started = Date.now()

  // The audit has to run inside the callback: the halves are freed as soon as the
  // build has flattened them to triangles, so a handle kept past that point is
  // pointing at released WASM memory.
  console.log('── Manifold topology, all features ──')
  // The base audit needs the halves and the plinth alive at the same time, and the
  // plinth is only built after the jacket callback has returned — so the halves are
  // stashed for the moment the base arrives rather than audited and dropped.
  const { Manifold } = await manifoldRuntime()
  let halves = null
  const result = await buildMould(buf, DEFAULT_PARAMS, () => {}, {
    onJacket: (h) => { auditHalves(h); halves = h },
    onBase: (base) => auditBase(Manifold, base, halves, DEFAULT_PARAMS),
  })
  auditBores(result.stats)
  console.log(`built in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log('stats:', JSON.stringify(result.stats, null, 1))
  for (const part of result.parts) write(`${process.env.SCRATCH}/${part.name}`, Buffer.from(part.stl))

  console.log('── Manifold topology, every hole disabled (genus 0, pieces 1) ──')
  await buildMould(buf, {
    ...DEFAULT_PARAMS,
    boltHoleDiameterMM: 0, sprueDiameterMM: 0, ventDiameterMM: 0, registrationPinDiameterMM: 0,
  }, () => {}, { onJacket: auditHalves })
  return result
}
