// Checks the keyed seat in the top of the plinth actually keys.
//
// Two things have to hold at once and they pull against each other: the closed
// jacket must drop straight into the recess without touching it, and it must not
// be able to sit anywhere else. So the test lowers the halves in, then shoves the
// pair sideways and looks for the collision that proves the lip is doing its job.
export function auditBase(Manifold, { plinth }, { front, back }, params) {
  const closed = Manifold.union([front, back])
  const clearance = params.registrationClearanceMM

  const clash = (dx) => {
    const moved = closed.translate([dx, 0, 0])
    const hit = plinth.intersect(moved)
    const volume = hit.volume()
    moved.delete()
    hit.delete()
    return volume
  }

  const spin = (deg) => {
    const moved = closed.rotate([0, 0, deg])
    const hit = plinth.intersect(moved)
    const volume = hit.volume()
    moved.delete()
    hit.delete()
    return volume
  }

  const seated = clash(0)
  const nudged = clash(clearance * 0.5)
  const shoved = clash(clearance + 0.75)
  // A lathed master projects to a circle, which pins X and Y and lets the jacket
  // spin freely. What stops it is the flange, whose ears cut two channels out
  // through the lip — so rotation is the test that says whether the recess is
  // really keyed or merely centred.
  const twisted = spin(3)

  const tv = plinth.getMesh().triVerts
  const edges = new Map()
  for (let t = 0; t < tv.length; t += 3) {
    for (const [u, v] of [[tv[t], tv[t + 1]], [tv[t + 1], tv[t + 2]], [tv[t + 2], tv[t]]]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
  }
  let boundary = 0, nonManifold = 0
  for (const n of edges.values()) { if (n === 1) boundary++; else if (n !== 2) nonManifold++ }

  const box = plinth.boundingBox()
  console.log(
    `  plinth       tris=${String(plinth.numTri()).padStart(7)} genus=${String(plinth.genus()).padStart(3)}` +
    ` pieces=${plinth.decompose().length} vol=${(plinth.volume() / 1000).toFixed(1)}ml` +
    ` boundaryEdges=${boundary} nonManifoldEdges=${nonManifold}` +
    `  ${boundary === 0 && nonManifold === 0 ? 'CLOSED 2-MANIFOLD' : 'DEFECT'}`,
  )
  console.log(`  top of plinth z=${box.max[2].toFixed(2)}mm (seat + key)`)
  console.log(`  seated                       overlap=${seated.toFixed(3)}mm³  ${seated < 1e-6 ? 'DROPS IN' : 'FOULS'}`)
  console.log(`  nudged ${(clearance * 0.5).toFixed(2)}mm (inside slop)   overlap=${nudged.toFixed(3)}mm³  ${nudged < 1e-6 ? 'still free' : 'FOULS'}`)
  console.log(`  shoved ${(clearance + 0.75).toFixed(2)}mm (past slop)    overlap=${shoved.toFixed(3)}mm³  ${shoved > 1 ? 'BLOCKED — keyed' : 'NOT KEYED'}`)
  console.log(`  twisted 3°                   overlap=${twisted.toFixed(3)}mm³  ${twisted > 1 ? 'BLOCKED — rotation pinned' : 'FREE TO SPIN'}`)
  closed.delete()
}
