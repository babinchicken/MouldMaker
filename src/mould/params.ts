/**
 * Parameters for turning a master model into a printable silicone-mould kit.
 *
 * All dimensions are millimetres. The model is worked on standing up: +Z is the
 * stand axis, the plinth is at the bottom, the standing pad at the top.
 */

export type SprueMode = 'offset' | 'pair' | 'split'

export const SPRUE_MODES: Array<{ value: SprueMode; label: string; hint: string }> = [
  { value: 'offset', label: 'One, off-seam', hint: 'A single round bore wholly in one half.' },
  { value: 'pair', label: 'One in each half', hint: 'Pour down one, air and overflow rise up the other.' },
  { value: 'split', label: 'Split on the seam', hint: 'One wide bore centred on the plane, half in each.' },
]

export interface MouldParams {
  // ── Size ────────────────────────────────────────────────────────────────
  /** Height to scale the master to before anything else happens.
   *
   *  STL carries no units, and generated models rarely arrive at print size —
   *  they come normalised to a unit cube, or in metres, or in whatever the
   *  generator felt like. Taking the file's numbers as millimetres gives either a
   *  grid too vast to compute or a jacket built around a speck. So the model is
   *  always scaled to this height and the original size is reported back. */
  targetHeightMM: number

  // ── The silicone ────────────────────────────────────────────────────────
  /** Gap between master and jacket — this *is* the wall thickness of the finished
   *  silicone mould, and the dominant cost: silicone is far more expensive per
   *  gram than filament, so a conformal skin uses a fraction of a solid block. */
  siliconeThicknessMM: number

  // ── The jacket (the rigid two-part cover) ───────────────────────────────
  /** Printed wall thickness of the jacket itself. */
  jacketWallMM: number
  /** Which way the two halves pull apart, as a bearing in the XY plane.
   *
   *  0° parts left from right, 90° parts front from back. Anything between splits
   *  on that diagonal, which is how you steer the seam away from a face or an
   *  ornament you would rather not have a parting line down. The plane always runs
   *  through the model's centre; only its bearing changes. */
  partingAngleDeg: number
  /** Clamping lip around the parting plane. */
  flangeWidthMM: number
  flangeThicknessMM: number
  /** Through-holes in the flange. 3.4mm clears an M3 bolt; 0 disables them. */
  boltHoleDiameterMM: number
  boltCount: number
  /** Cones on one half, sockets on the other, so the halves can only close one
   *  way and can't slide while clamped. */
  registrationPinDiameterMM: number
  registrationPinDepthMM: number
  registrationClearanceMM: number

  // ── The base, unioned onto the master ───────────────────────────────────
  /** Height of the square plinth under the model. */
  plinthHeightMM: number
  /** How far the plinth sticks out past the jacket's outer wall. The jacket seats
   *  on this lip, which is what closes the bottom of the cavity. */
  plinthMarginMM: number
  /** Depth of the keyed seat sunk into the top of the plinth.
   *
   *  A flat plinth locates the jacket in Z and nothing else — it can slide and spin
   *  on the lip, and any drift there opens a gap for silicone to weep out of and
   *  puts the parting seam somewhere other than where it was designed. So the top
   *  of the plinth is raised by this much and the jacket's own footprint cut back
   *  out of it: a recess shaped like the foot, ringed by a raised lip. The foot
   *  drops into exactly one position, and rotation is pinned by the outline being
   *  the model's own silhouette rather than a circle.
   *
   *  Capped below the silicone thickness on purpose — see maxBaseKeyHeight. */
  baseKeyHeightMM: number

  /** Width of a flat skirt of silicone around the foot of the mould — the same
   *  idea as a slicer brim.
   *
   *  The jacket grows a dammed step at its base for the silicone to flow out into,
   *  and the plinth's top face forms the underside. What you get is a mould with a
   *  flat flange all round: something to clamp, and a surface for a plaster or
   *  fibreglass mother mould to key against later. 0 leaves the foot bare. */
  brimWidthMM: number

  // ── Standing square + pour ──────────────────────────────────────────────
  /** Flat square pad on top of the jacket, so the clamped assembly stands on
   *  its head end as readily as on its plinth. */
  standSquareSideMM: number
  standSquareThicknessMM: number
  /** Pour opening down through the standing pad. */
  sprueDiameterMM: number
  /** How the pour opening is arranged around the seam.
   *
   *  `offset` puts one bore to one side of the parting plane, so it comes out as a
   *  clean round hole in a single half. `pair` bores one either side: you pour down
   *  the first and the second carries the air and the overflow back out, which is
   *  the old sprue-and-riser arrangement and keeps both holes round. `split` centres
   *  one wider bore on the plane itself, giving the largest opening for a given pad
   *  at the cost of two half-channels that have to meet, and a pour that lands
   *  straight down on the crown. */
  sprueMode: SprueMode
  /** Thin channels at the pad corners so displaced air escapes instead of
   *  leaving voids under the crown. 0 disables them. */
  ventDiameterMM: number

  // ── Quality ─────────────────────────────────────────────────────────────
  /** Grid spacing for the offset computation. Smaller keeps finer detail in the
   *  jacket's inner face but costs memory and time cubically. */
  resolutionMM: number
}

export const DEFAULT_PARAMS: MouldParams = {
  targetHeightMM: 100,
  siliconeThicknessMM: 3,
  jacketWallMM: 3,
  partingAngleDeg: 90,
  flangeWidthMM: 12,
  flangeThicknessMM: 5,
  boltHoleDiameterMM: 3.4,
  boltCount: 6,
  registrationPinDiameterMM: 6,
  registrationPinDepthMM: 2.5,
  registrationClearanceMM: 0.25,
  plinthHeightMM: 6,
  plinthMarginMM: 4,
  baseKeyHeightMM: 2,
  brimWidthMM: 0,
  standSquareSideMM: 26,
  standSquareThicknessMM: 4,
  sprueDiameterMM: 8,
  sprueMode: 'offset',
  ventDiameterMM: 1.6,
  resolutionMM: 1.0,
}

/**
 * The deepest keyed seat the jacket can still be assembled into.
 *
 * The halves have to close around the master horizontally, so they cannot be
 * dropped into a pocket while already seated — you close them just clear of the
 * plinth and then lower the pair in. That last move is safe only while it is
 * shorter than the silicone gap: the cavity is the master grown by exactly
 * siliconeThicknessMM, so any translation smaller than that cannot bring the two
 * into contact, whatever shape the master is. Half a millimetre is held back so
 * the fit stays a fit rather than a scrape.
 */
export function maxBaseKeyHeight(p: MouldParams): number {
  return Math.max(0, p.siliconeThicknessMM - 0.5)
}

/**
 * The coarsest grid that still resolves the thinnest feature. Past this, marching
 * tetrahedra steps straight over the silicone gap and the jacket comes out solid.
 */
export function maxResolution(p: MouldParams): number {
  return Math.min(p.siliconeThicknessMM, p.jacketWallMM) / 2
}

/**
 * Settles constraints that span more than one field, so editing one control can't
 * strand another out of range — dropping the silicone thickness has to drag the
 * resolution down with it, rather than waiting to fail in validation.
 */
export function reconcile(p: MouldParams): MouldParams {
  const resolutionMM = Math.min(p.resolutionMM, maxResolution(p))
  const baseKeyHeightMM = Math.min(p.baseKeyHeightMM, maxBaseKeyHeight(p))
  if (resolutionMM === p.resolutionMM && baseKeyHeightMM === p.baseKeyHeightMM) return p
  return { ...p, resolutionMM, baseKeyHeightMM }
}

/** Throws on any combination that can't produce a printable kit. */
export function validate(p: MouldParams): void {
  if (p.targetHeightMM <= 0) throw new Error('Model height must be positive')
  if (!Number.isFinite(p.partingAngleDeg)) throw new Error('Parting angle must be a number')
  if (p.siliconeThicknessMM <= 0) throw new Error('Silicone thickness must be positive')
  if (p.jacketWallMM <= 0) throw new Error('Jacket wall must be positive')
  if (p.flangeWidthMM < 0 || p.flangeThicknessMM < 0) throw new Error('Flange dimensions must not be negative')
  if (p.boltHoleDiameterMM > 0 && p.boltHoleDiameterMM + 2 >= p.flangeWidthMM) {
    throw new Error('Bolt holes need a wider flange — they would break through its edge')
  }
  if (p.plinthHeightMM <= 0) throw new Error('Plinth height must be positive')
  if (p.plinthMarginMM < 0) throw new Error('Plinth margin must not be negative')
  if (p.baseKeyHeightMM < 0) throw new Error('Base key depth must not be negative')
  if (p.baseKeyHeightMM > maxBaseKeyHeight(p)) {
    throw new Error(
      `A ${p.baseKeyHeightMM}mm keyed seat is deeper than the ${p.siliconeThicknessMM}mm silicone gap ` +
      `allows — the closed jacket could not be lowered into it without fouling the master. ` +
      `Use ${maxBaseKeyHeight(p).toFixed(1)}mm or less.`,
    )
  }
  if (p.brimWidthMM < 0) throw new Error('Brim width must not be negative')
  if (!SPRUE_MODES.some((mode) => mode.value === p.sprueMode)) {
    throw new Error(`Unknown sprue arrangement "${p.sprueMode}"`)
  }
  // A pair sits side by side across the plane, so between them they need room for
  // two bores rather than one.
  const sprueSpan = p.sprueMode === 'pair' ? p.sprueDiameterMM * 2 + 2 : p.sprueDiameterMM
  if (p.sprueDiameterMM > 0 && sprueSpan >= p.standSquareSideMM) {
    throw new Error(
      p.sprueMode === 'pair'
        ? `Two ${p.sprueDiameterMM}mm sprues will not fit across a ${p.standSquareSideMM}mm pad — widen the pad or narrow the sprue`
        : 'Sprue is wider than the standing pad it passes through',
    )
  }
  // The grid has to resolve the thinner of the two offsets, or marching tetrahedra
  // walks straight past the silicone gap and the jacket comes out solid.
  const thinnest = Math.min(p.siliconeThicknessMM, p.jacketWallMM)
  if (p.resolutionMM > maxResolution(p)) {
    throw new Error(
      `Resolution ${p.resolutionMM}mm is too coarse for a ${thinnest}mm feature — use ${maxResolution(p).toFixed(2)}mm or finer`,
    )
  }
}
