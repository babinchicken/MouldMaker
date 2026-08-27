import * as THREE from 'three'
import type { Box, Manifold } from 'manifold-3d'
import { manifoldRuntime } from './manifoldRuntime'
import { buildDistanceGrid, occupiedVolume, sampler } from './sdf'
import { buildJacket } from './jacket'
import { maxResolution, validate, type MouldParams } from './params'
import { Arena } from './arena'
import { boxSoup, manifoldToSoup, parseStl, writeBinaryStl, type TriangleSoup } from './stl'

export interface MouldPart {
  name: string
  soup: TriangleSoup
  stl: ArrayBuffer
}

export interface MouldResult {
  parts: MouldPart[]
  /** Preview geometry for the untouched master, already moved onto its plinth. */
  masterPositions: Float32Array
  stats: {
    /** Height of the model as the file described it, before scaling. */
    sourceHeightUnits: number
    appliedScale: number
    modelHeightMM: number
    modelWidthMM: number
    modelDepthMM: number
    plinthSideMM: number
    /** What to mix: the skin, plus the brim and the channels the pour stands in. */
    siliconeVolumeML: number
    siliconeSkinML: number
    siliconeBrimML: number
    siliconeBoresML: number
    /** The same total as a weight, which is how silicone is sold and mixed. */
    siliconeGrams: number
    jacketTriangles: number
    gridSamples: number
    /** Pour channels that found cavity to break into, and how much of the narrowest
     *  one's mouth came out open. */
    bores: { sprues: number; sprueTarget: number; vents: number; ventTarget: number; worstMouth: number }
  }
  notes: string[]
}

/**
 * Where the grid stops fitting in Manifold's WASM heap.
 *
 * Measured rather than derived: 250mm at 1.0mm (9.1M) and 300mm at 1.2mm (8.8M)
 * both build, while 300mm at 1.0mm (14.8M) traps. Sample count alone does not
 * predict it — 400mm at 1.5mm fails at 10.3M while 270mm at 1.0mm survives 11.3M,
 * because the level sets' own triangle counts differ — so this sits at the top of
 * the range where everything tested passed rather than at the first observed
 * failure.
 */
const MAX_GRID_SAMPLES = 10e6

/** Thinnest lip worth printing around the keyed seat. */
const MIN_KEY_LIP_MM = 2

/**
 * Typical cured density of RTV silicone, for turning the volume into a weight.
 *
 * Silicone is sold by weight and mixed by weight, so millilitres are the wrong unit
 * to end on. The common casting rubbers sit between 1.05 and 1.20 — Ecoflex at 1.07,
 * Dragon Skin 1.08, Mold Star 1.13 — so this is the middle of that range and is
 * quoted as approximate wherever it is shown.
 */
const SILICONE_DENSITY_G_PER_ML = 1.1

/** The reinforced top section uses a deeper silicone skin to help it fill. */
const TOP_SKIN_FRACTION = 0.20
const TOP_SKIN_THICKNESS_MM = 10

export type Progress = (stage: string, fraction: number) => void

export interface BuildOptions {
  /** Handed the jacket halves as live Manifold solids, before they are flattened
   *  to triangles. Lets a caller interrogate the real topology — genus, volume,
   *  connected pieces — which triangle soup can no longer answer. */
  onJacket?: (halves: { front: Manifold; back: Manifold }) => void
  /** Handed the keyed plinth as a live solid, on the same terms as onJacket — and
   *  only when the keyed seat is on, since a plain plinth never becomes one. */
  onBase?: (base: { plinth: Manifold }) => void
}

/**
 * Master model in, printable mould kit out.
 *
 * The master is never turned into a solid: only its distance field is, which is
 * what lets a downloaded statue STL with the usual crop of duplicate vertices and
 * flipped faces go straight in. Every boolean afterwards runs on level sets and
 * primitives, which are watertight by construction.
 */
export async function buildMould(
  stlBuffer: ArrayBuffer,
  params: MouldParams,
  onProgress: Progress = () => {},
  options: BuildOptions = {},
): Promise<MouldResult> {
  validate(params)
  const wasm = await manifoldRuntime()
  const { Manifold } = wasm
  const notes: string[] = []
  // The level sets are the largest objects in the process and Manifold's handles
  // are not garbage-collected, so they are released explicitly once the parts have
  // been flattened to triangles. Without this a 300mm model exhausts the WASM heap
  // partway through and dies with "memory access out of bounds".
  const arena = new Arena()

  onProgress('Reading model', 0)
  const geometry = parseStl(stlBuffer)
  geometry.computeBoundingBox()
  const raw = geometry.boundingBox
  if (!raw) throw new Error('Model has no geometry')

  // ── Scale to print size, then stand it on its plinth, centred on Z ──
  const rawSize = new THREE.Vector3()
  raw.getSize(rawSize)
  if (rawSize.z <= 0) throw new Error('Model is flat along Z — it needs to stand up to be moulded')
  const sourceHeightUnits = rawSize.z
  const appliedScale = params.targetHeightMM / sourceHeightUnits
  geometry.scale(appliedScale, appliedScale, appliedScale)
  geometry.computeBoundingBox()
  const scaled = geometry.boundingBox!
  geometry.translate(
    -(scaled.min.x + scaled.max.x) / 2,
    -(scaled.min.y + scaled.max.y) / 2,
    -scaled.min.z + params.plinthHeightMM,
  )
  geometry.computeBoundingBox()
  const master = geometry.boundingBox!
  const seatZ = params.plinthHeightMM
  const topSkinStartZ = master.min.z + (master.max.z - master.min.z) * (1 - TOP_SKIN_FRACTION)
  const topSkinThickness = Math.max(params.siliconeThicknessMM, TOP_SKIN_THICKNESS_MM)
  const skinThicknessAt = (z: number): number => {
    if (z <= topSkinStartZ || topSkinThickness === params.siliconeThicknessMM) {
      return params.siliconeThicknessMM
    }
    const progress = Math.min(1, (z - topSkinStartZ) / (master.max.z - topSkinStartZ))
    return params.siliconeThicknessMM + (topSkinThickness - params.siliconeThicknessMM) * progress
  }

  // ── Signed distance field around the master ──
  const maximumSkin = topSkinThickness
  const grow = maximumSkin + params.jacketWallMM
  const pad = grow + params.resolutionMM * 3
  const bounds = master.clone().expandByScalar(pad)
  const gridSize = new THREE.Vector3()
  bounds.getSize(gridSize)
  const samples =
    Math.ceil(gridSize.x / params.resolutionMM) *
    Math.ceil(gridSize.y / params.resolutionMM) *
    Math.ceil(gridSize.z / params.resolutionMM)
  if (samples > MAX_GRID_SAMPLES) {
    // Suggest the resolution that would fit. Sample count goes as the cube of
    // 1/resolution, so a small step coarser buys a lot of headroom.
    const needed = params.resolutionMM * Math.cbrt(samples / MAX_GRID_SAMPLES)
    const ceiling = maxResolution(params)
    const remedy = needed <= ceiling
      ? `Set the detail resolution to ${(Math.ceil(needed * 20) / 20).toFixed(2)}mm or coarser.`
      : `Even the coarsest usable resolution (${ceiling.toFixed(2)}mm, set by your ` +
        `${Math.min(params.siliconeThicknessMM, params.jacketWallMM)}mm thinnest feature) will not fit ` +
        'this — reduce the model height.'
    throw new Error(
      `A ${params.targetHeightMM}mm model at ${params.resolutionMM}mm needs ` +
      `${(samples / 1e6).toFixed(1)}M grid samples, past the ${MAX_GRID_SAMPLES / 1e6}M this can hold. ${remedy}`,
    )
  }

  const grid = buildDistanceGrid(geometry, bounds, params.resolutionMM, pad, (f) =>
    onProgress('Measuring the model', f),
  )
  const sample = sampler(grid)

  // ── Two outward offsets: the cavity, and the jacket's outer skin ──
  const levelBounds: Box = {
    min: [bounds.min.x, bounds.min.y, bounds.min.z],
    max: [bounds.max.x, bounds.max.y, bounds.max.z],
  }
  // Manifold works in a fixed WASM heap. Past a certain grid the level sets no
  // longer fit and it aborts with a raw trap — "memory access out of bounds" or
  // "table index is out of bounds" — which says nothing about what to change.
  // Translate it into the two knobs that actually help.
  const outOfRoom = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (!/out of bounds|memory|allocat/i.test(message)) return error
    return new Error(
      `Ran out of room at ${params.targetHeightMM}mm and ${params.resolutionMM}mm resolution ` +
      `(${(samples / 1e6).toFixed(1)}M grid samples). Coarsen the detail resolution, or reduce ` +
      'the model height.',
    )
  }

  let jacket: ReturnType<typeof buildJacket>
  try {
    const variableField = (wallExtra: number) => (point: [number, number, number]) =>
      sample(point) + skinThicknessAt(point[2]) + wallExtra
    onProgress('Growing the silicone skin', 0.35)
    const siliconeOuter = arena.keep(
      Manifold.levelSet(variableField(0), levelBounds, params.resolutionMM, 0),
    )
    onProgress('Growing the jacket shell', 0.55)
    const jacketOuter = arena.keep(
      Manifold.levelSet(variableField(params.jacketWallMM), levelBounds, params.resolutionMM, 0),
    )
    const cavityTopZ = siliconeOuter.boundingBox().max[2]

    onProgress('Building the jacket', 0.75)
    jacket = buildJacket(wasm, { siliconeOuter, jacketOuter, seatZ, cavityTopZ, params })
    options.onJacket?.({ front: jacket.front, back: jacket.back })
  } catch (error) {
    arena.release()
    throw outOfRoom(error)
  }

  // ── The plinth, sized to overhang the jacket so it seals the cavity ──
  // Measured from whatever actually has to seat: with a brim that is the dam
  // around it, not the jacket wall, and the brim has no floor if the plinth stops
  // short of it.
  //
  // The keyed seat needs a lip to stand on as well, so the overhang is widened if
  // it is too thin to leave one — a lip a fraction of a millimetre wide would
  // print as a fin and snap off the first time the jacket went on.
  const keyHeight = jacket.seatPocket ? params.baseKeyHeightMM : 0
  const overhang = keyHeight > 0
    ? Math.max(params.plinthMarginMM, params.registrationClearanceMM + MIN_KEY_LIP_MM)
    : params.plinthMarginMM
  const plinthSide = 2 * (jacket.sealHalfExtentMM + overhang)

  // Raised by the key depth, then the jacket's own footprint cut back out of the
  // raised part: what is left is a recess shaped like the foot inside a lip. Below
  // the seat plane nothing changes, so the cavity floor is still the flat top of
  // the plinth proper.
  let plinth: TriangleSoup
  if (jacket.seatPocket) {
    const blank = arena.keep(
      arena.keep(Manifold.cube([plinthSide, plinthSide, seatZ + keyHeight], true))
        .translate([0, 0, (seatZ + keyHeight) / 2]),
    )
    const keyed = arena.keep(blank.subtract(jacket.seatPocket))
    options.onBase?.({ plinth: keyed })
    plinth = manifoldToSoup(keyed)
  } else {
    plinth = boxSoup(
      new THREE.Vector3(-plinthSide / 2, -plinthSide / 2, 0),
      new THREE.Vector3(plinthSide / 2, plinthSide / 2, seatZ),
    )
  }

  const masterSoups: TriangleSoup[] = [
    { positions: geometry.getAttribute('position').array as Float32Array },
    plinth,
  ]

  onProgress('Writing STLs', 0.9)
  const frontSoup = manifoldToSoup(jacket.front)
  const backSoup = manifoldToSoup(jacket.back)
  const jacketTriangles = jacket.front.numTri() + jacket.back.numTri()
  const parts: MouldPart[] = [
    { name: 'master-with-base.stl', soup: mergeSoups(masterSoups), stl: writeBinaryStl(masterSoups) },
    { name: 'jacket-front.stl', soup: frontSoup, stl: writeBinaryStl([frontSoup]) },
    { name: 'jacket-back.stl', soup: backSoup, stl: writeBinaryStl([backSoup]) },
  ]

  // Straight off the distance grid: each height band uses the offset that built its
  // skin, less the master itself. The grid cannot see anything cut or added by
  // boolean after it was measured, so the brim and the pour channels are carried
  // separately — miss one and the readout quietly asks you to mix too little.
  const skinMM3 = Math.max(
    0,
    occupiedVolume(grid, (z) => -skinThicknessAt(z), seatZ) -
      occupiedVolume(grid, 0, seatZ),
  )
  const siliconeMM3 = skinMM3 + jacket.brimExtraMM3 + jacket.boreExtraMM3
  const pour = params.sprueMode === 'pair'
    ? 'Pour down either opening in the pad — the other carries the air and the overflow back out'
    : params.sprueMode === 'split'
      ? 'Pour through the opening straddling the seam; it lands on the crown, so pour slowly'
      : 'Pour through the sprue in the standing pad'
  notes.push(
    `${pour}${params.ventDiameterMM > 0 ? '; the vents take the last of the trapped air' : ''}. ` +
    `Clamp the halves with M${Math.round(params.boltHoleDiameterMM - 0.4)} bolts before pouring.`,
  )
  const { sprues, sprueTarget, vents, ventTarget, worstMouth } = jacket.boresPlaced
  if (sprues + vents > 0 && worstMouth < 0.99) {
    notes.push(
      `One of the pour channels only opens over ${(worstMouth * 100).toFixed(0)}% of its width where it ` +
      'meets the cavity. It will still work, but it is narrower inside than it looks from the pad.',
    )
  }
  if (sprues < sprueTarget) {
    notes.push(
      `Only ${sprues} of ${sprueTarget} pour openings could be drilled — the rest found no ` +
      'cavity under the pad to break into. Widen the standing pad, or narrow the sprue.',
    )
  }
  if (vents < ventTarget) {
    notes.push(
      `${ventTarget - vents} of ${ventTarget} vents could not be placed: there is no cavity ` +
      'under that part of the pad. A wider pad gives them somewhere to reach.',
    )
  }

  const breakdown = [`${(skinMM3 / 1000).toFixed(0)}ml skin`]
  if (jacket.brimExtraMM3 > 0) breakdown.push(`${(jacket.brimExtraMM3 / 1000).toFixed(1)}ml brim`)
  if (jacket.boreExtraMM3 > 0) breakdown.push(`${(jacket.boreExtraMM3 / 1000).toFixed(1)}ml in the sprue and vents`)
  notes.push(`Silicone: ${breakdown.join(' + ')}. Mix a little over — none of it is recoverable.`)
  if (keyHeight > 0) {
    notes.push(
      `The plinth top is keyed ${keyHeight}mm deep to the jacket's foot. Close the two ` +
      `halves around the master just clear of the plinth, then lower the pair into the ` +
      `recess — they will not slide in sideways.`,
    )
  }

  // Nothing beyond this point touches a Manifold — the parts are plain triangles.
  arena.release()
  jacket.front.delete()
  jacket.back.delete()
  jacket.seatPocket?.delete()

  onProgress('Done', 1)
  return {
    parts,
    masterPositions: geometry.getAttribute('position').array as Float32Array,
    stats: {
      sourceHeightUnits,
      appliedScale,
      modelHeightMM: master.max.z - master.min.z,
      modelWidthMM: master.max.x - master.min.x,
      modelDepthMM: master.max.y - master.min.y,
      plinthSideMM: plinthSide,
      siliconeVolumeML: siliconeMM3 / 1000,
      siliconeSkinML: skinMM3 / 1000,
      siliconeBrimML: jacket.brimExtraMM3 / 1000,
      siliconeBoresML: jacket.boreExtraMM3 / 1000,
      siliconeGrams: (siliconeMM3 / 1000) * SILICONE_DENSITY_G_PER_ML,
      jacketTriangles,
      gridSamples: samples,
      bores: jacket.boresPlaced,
    },
    notes,
  }
}

function mergeSoups(soups: TriangleSoup[]): TriangleSoup {
  const total = soups.reduce((n, s) => n + s.positions.length, 0)
  const positions = new Float32Array(total)
  let at = 0
  for (const soup of soups) {
    positions.set(soup.positions, at)
    at += soup.positions.length
  }
  return { positions }
}
