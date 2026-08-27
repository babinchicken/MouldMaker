// Reports Manifold's own view of each jacket half — genus, volume and an edge
// audit over its indexed mesh. Runs the real pipeline rather than a copy of it,
// so it cannot drift out of step with what the app actually builds.
export function auditHalves({ front, back }) {
  for (const [name, part] of [['front', front], ['back', back]]) {
    const tv = part.getMesh().triVerts
    const edges = new Map()
    for (let t = 0; t < tv.length; t += 3) {
      for (const [u, v] of [[tv[t], tv[t + 1]], [tv[t + 1], tv[t + 2]], [tv[t + 2], tv[t]]]) {
        const k = u < v ? `${u}_${v}` : `${v}_${u}`
        edges.set(k, (edges.get(k) ?? 0) + 1)
      }
    }
    let boundary = 0, nonManifold = 0
    for (const n of edges.values()) { if (n === 1) boundary++; else if (n !== 2) nonManifold++ }
    console.log(
      `  jacket-${name.padEnd(6)} tris=${String(part.numTri()).padStart(7)} genus=${String(part.genus()).padStart(3)}` +
      ` pieces=${part.decompose().length} vol=${(part.volume() / 1000).toFixed(1)}ml` +
      ` boundaryEdges=${boundary} nonManifoldEdges=${nonManifold}` +
      `  ${boundary === 0 && nonManifold === 0 ? 'CLOSED 2-MANIFOLD' : 'DEFECT'}`,
    )
  }

  // Whether the two halves can actually close on each other. Nothing above can see
  // this: a registration cone with no socket to sit in leaves both parts perfectly
  // closed 2-manifolds, and only shows up as the pair overlapping in space.
  const hit = front.intersect(back)
  const clash = hit.volume()
  console.log(
    `  halves        front∩back=${clash.toFixed(3)}mm³` +
    `  ${clash < 0.01 ? 'CLOSE' : 'INTERFERE — a key has no socket'}`,
  )
  hit.delete()
}

/** Every pour channel has to open into the cavity over its whole width. */
export function auditBores(stats) {
  const bores = stats.bores
  console.log(
    `  bores         ${bores.sprues}/${bores.sprueTarget} sprue, ${bores.vents}/${bores.ventTarget} vent  ` +
    `narrowest mouth ${(bores.worstMouth * 100).toFixed(0)}% open  ` +
    `${(stats.siliconeBoresML * 1000).toFixed(0)}mm³ of silicone stands in them  ` +
    `${bores.worstMouth > 0.99 && bores.sprues === bores.sprueTarget && bores.vents === bores.ventTarget
      ? 'ALL THROUGH' : 'PARTIAL — a mouth is roofed over'}`,
  )
}
