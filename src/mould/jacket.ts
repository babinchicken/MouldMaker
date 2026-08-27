import type { ManifoldToplevel, Manifold, CrossSection, Box, Vec2, Vec3 } from 'manifold-3d'
import type { MouldParams } from './params'
import { Arena } from './arena'

export interface JacketInput {
  /** Master grown by the silicone thickness — the cavity the silicone fills. */
  siliconeOuter: Manifold
  /** Master grown by silicone thickness + jacket wall — the jacket's outer skin. */
  jacketOuter: Manifold
  /** Plane the jacket seats on: the top face of the master's plinth. */
  seatZ: number
  /** Top of the silicone cavity — the sprue and vents must reach past this. */
  cavityTopZ: number
  params: MouldParams
}

export interface JacketParts {
  front: Manifold
  back: Manifold
  /** Half-width of the footprint that has to land on the plinth for the cavity to
   *  seal — the brim dam when there is one, the plain wall otherwise. */
  sealHalfExtentMM: number
  /** Silicone the brim adds over the plain skin. The caller estimates the skin off
   *  the distance field, which has no knowledge of a shape added by boolean after
   *  the fact — so without this the brim is poured for but never counted. */
  brimExtraMM3: number
  /** Silicone standing in the sprue and vent channels once the pour is up to the
   *  pad. Same blind spot as the brim: these are cut after the field is measured,
   *  and it is real material you have to mix, not a rounding error. */
  boreExtraMM3: number
  /** The recess to cut into the top of the plinth so the jacket foot can only sit
   *  one way — null when the keyed seat is switched off. Owned by the caller. */
  seatPocket: Manifold | null
  /** Channels that found cavity to break into, against the number asked for. A
   *  bore that finds none is left undrilled rather than shipped blind. */
  boresPlaced: {
    sprues: number; sprueTarget: number; vents: number; ventTarget: number
    /** Smallest share of any mouth that opened into the cavity. 1 is a full circle;
     *  anything less means a bore breaks through over only part of its width. */
    worstMouth: number
  }
  /** Where the halves part, along the parting axis. */
  partingOffset: number
  /** Top face of the standing pad. */
  padTopZ: number
}

const CIRCLE_SEGMENTS = 48

/** How far a socket's mouth reaches past the parting plane, so it reads as an
 *  opening rather than a capped cavity. */
const SOCKET_OVERSHOOT = 0.5

/** How far below the cavity's highest point a bore may go looking for its roof. */
const CROWN_SLAB_MM = 40

/** Step the vent walks inward by while hunting for cavity under it. */
const VENT_STEP_MM = 1

/** How far past the cavity's roof a bore drops, so its mouth opens cleanly. */
const BREAK_THROUGH_MM = 0.5

/** Avoids a circular cutter sharing an edge with the split face. */
const SPLIT_BORE_NUDGE_MM = 0.01

/**
 * Builds the two-part rigid cover.
 *
 * Everything is assembled as one outer solid first — dome, standing pad and
 * clamping flange — and only then split and hollowed. Cutting the cavity last
 * means the flange can be a plain slab that overlaps the dome freely, instead of
 * a ring that has to be trimmed to follow it.
 */
export function buildJacket(wasm: ManifoldToplevel, input: JacketInput): JacketParts {
  const { Manifold } = wasm
  const { siliconeOuter, jacketOuter, seatZ, cavityTopZ, params: p } = input

  // Every handle below is registered so it can be freed once the two halves have
  // been extracted; see Arena for why that matters.
  const arena = new Arena()
  const k = <T extends { delete(): void }>(value: T): T => arena.keep(value)

  // The parting plane is described by a bearing in XY: its normal is the direction
  // the halves pull apart, and its tangent runs along the seam.
  const bearing = (p.partingAngleDeg * Math.PI) / 180
  const normalX = Math.cos(bearing)
  const normalY = Math.sin(bearing)
  const partingNormal: Vec3 = [normalX, normalY, 0]
  const tangent: [number, number] = [-normalY, normalX]

  // Work the flange in a frame where the parting axis is Z, because slice() only
  // ever cuts parallel to XY. Rotating back afterwards is exact — these are
  // quarter turns about a principal axis.
  /**
   * The stand axis (world Z) as seen in the parting frame. Spinning about Z first
   * leaves the Z axis untouched, so it always lands on -X regardless of bearing.
   * Used to tell which flange-ring points still have flange beneath them.
   */
  const standAxisOf = (point: Vec2): number => -point[0]

  // slice() only ever cuts parallel to XY, so the solid is spun until the parting
  // normal points along +Z: turn the bearing back to the X axis, then tip X onto Z.
  const intoPartingFrame = (m: Manifold): Manifold =>
    k(k(m.rotate([0, 0, -p.partingAngleDeg])).rotate([0, -90, 0]))
  const outOfPartingFrame = (m: Manifold): Manifold =>
    k(k(m.rotate([0, 90, 0])).rotate([0, 0, p.partingAngleDeg]))

  // Part along the model's midline on that axis. The widest section would shed
  // more undercut, but the midline is predictable, and a statue's silhouette is
  // near enough symmetric that the difference rarely pays for the surprise.
  const outerBox = jacketOuter.boundingBox()
  const centreX = (outerBox.min[0] + outerBox.max[0]) / 2
  const centreY = (outerBox.min[1] + outerBox.max[1]) / 2
  // Distance from the origin to the plane, measured along its own normal.
  const partingOffset = centreX * normalX + centreY * normalY
  const topZ = outerBox.max[2]

  // ── Outer solid: dome above the seat, plus the standing pad ──
  let outerSolid = k(jacketOuter.trimByPlane([0, 0, 1], seatZ))

  // The pad drops into the dome far enough to fuse with it rather than perch on
  // the crown, which on a statue is a point rather than a surface.
  const padDrop = p.standSquareSideMM * 0.6
  const padTopZ = topZ + p.standSquareThicknessMM
  // Turned to face the seam, so the split runs parallel to an edge of the pad
  // rather than slicing it across a diagonal.
  const pad = k(k(k(Manifold.cube([p.standSquareSideMM, p.standSquareSideMM, padDrop + p.standSquareThicknessMM], true))
    .rotate([0, 0, p.partingAngleDeg]))
    .translate([centreX, centreY, padTopZ - (padDrop + p.standSquareThicknessMM) / 2]))
  outerSolid = k(outerSolid.add(pad))

  // ── Brim: a dammed step at the foot for the silicone to spread into ──
  // The step is cut from the cavity below, so the jacket ends up with a shallow
  // shelf all round; the plinth's top face closes its underside. Sized off the
  // silicone surface rather than the master, so the brim starts where the skin
  // ends instead of overlapping it.
  let brimCavity: Manifold | null = null
  let sealHalfExtentMM = halfExtentOf(outerBox)
  if (p.brimWidthMM > 0) {
    const foot = k(siliconeOuter.slice(seatZ))
    const brimOutline = k(k(foot.offset(p.brimWidthMM, 'Round', 2, CIRCLE_SEGMENTS)).simplify(0.05))
    brimCavity = k(k(brimOutline.extrude(p.siliconeThicknessMM)).translate([0, 0, seatZ]))

    // The dam has to stand outside the brim, or the silicone simply runs off the
    // plinth. It carries a jacket wall's worth of material above the brim too, so
    // the shelf has a roof rather than an open lip.
    const damOutline = k(k(brimOutline.offset(p.jacketWallMM, 'Round', 2, CIRCLE_SEGMENTS)).simplify(0.05))
    const dam = k(k(damOutline.extrude(p.siliconeThicknessMM + p.jacketWallMM)).translate([0, 0, seatZ]))
    outerSolid = k(outerSolid.add(dam))
    sealHalfExtentMM = halfExtentOf(dam.boundingBox())
  }

  // ── Clamping flange, straddling the parting plane ──
  const hasFlange = p.flangeWidthMM > 0 && p.flangeThicknessMM > 0
  // Taken from the dome-and-pad silhouette only. Re-slicing after the flange is
  // unioned on would offset from the flange's own edge, walking every subsequent
  // feature further outboard than intended.
  const silhouette = hasFlange ? k(intoPartingFrame(outerSolid).slice(partingOffset)) : null
  let flangeRing: Vec2[] = []

  if (silhouette) {
    const flangeOutline = k(k(silhouette.offset(p.flangeWidthMM, 'Round', 2, CIRCLE_SEGMENTS)).simplify(0.05))
    flangeRing = longestContour(
      k(k(silhouette.offset(p.flangeWidthMM / 2, 'Round', 2, CIRCLE_SEGMENTS)).simplify(0.05)),
    )
    // Symmetric about the plane, so each half ends up with a lip of exactly
    // flangeThicknessMM once split.
    let plate = outOfPartingFrame(
      k(k(flangeOutline.extrude(p.flangeThicknessMM * 2)).translate([0, 0, partingOffset - p.flangeThicknessMM])),
    )
    // A 2D offset grows the outline in every direction, including along the stand
    // axis — so left alone the flange would hang below the seat and tower over the
    // pad. Clip it back to the jacket's own extent.
    plate = k(k(plate.trimByPlane([0, 0, 1], seatZ)).trimByPlane([0, 0, -1], -padTopZ))
    outerSolid = k(outerSolid.add(plate))
  }

  // ── Keyed seat: the recess the plinth gets cut back to ──
  // Taken as the shadow of the slab from the seat up to the top of the lip, not as
  // a slice at the seat itself. A conformal shell over a statue usually flares as
  // it rises out of the plinth, and against a footprint measured at the foot alone
  // that flare would land on the lip and hold the jacket up off its seat.
  let seatPocket: Manifold | null = null
  if (p.baseKeyHeightMM > 0) {
    const slab = k(outerSolid.trimByPlane([0, 0, -1], -(seatZ + p.baseKeyHeightMM)))
    const shadow = k(k(slab.project()).simplify(0.05))
    const outline = k(k(shadow.offset(p.registrationClearanceMM, 'Round', 2, CIRCLE_SEGMENTS)).simplify(0.05))
    // Stands proud of the lip so the cut can't leave a film of plinth roofing the
    // recess where the two tops would otherwise be exactly coincident.
    seatPocket = k(k(outline.extrude(p.baseKeyHeightMM + 1)).translate([0, 0, seatZ]))
  }

  // ── Split, then hollow ──
  const [frontSolid, backSolid] = outerSolid.splitByPlane(partingNormal, partingOffset)
  k(frontSolid)
  k(backSolid)
  const skin = k(siliconeOuter.trimByPlane([0, 0, 1], seatZ))
  let cavity = skin
  let brimExtraMM3 = 0
  if (brimCavity) {
    cavity = k(skin.add(brimCavity))
    // Both sides of this are marched volumes, so their difference is the brim's
    // true contribution and carries none of the grid's bias.
    brimExtraMM3 = cavity.volume() - skin.volume()
  }

  let front = k(frontSolid.subtract(cavity))
  let back = k(backSolid.subtract(cavity))

  // ── Bolt holes and registration keys, spaced around the flange ──
  if (hasFlange && flangeRing.length > 2) {
    // The flange band runs past the seat and the pad in 2D before it gets clipped,
    // so a share of the ring describes thin air. Keep only the stretch that still
    // has flange under it, then spread the fasteners across what's left.
    const clearance = Math.max(p.boltHoleDiameterMM, p.registrationPinDiameterMM) / 2 + 1
    const onFlange = (point: Vec2) => {
      const z = standAxisOf(point)
      return z >= seatZ + clearance && z <= padTopZ - clearance
    }
    const candidates = samplePath(flangeRing, Math.max(24, p.boltCount * 6)).filter(onFlange)
    const spread = (count: number, phase: number): Vec2[] => {
      if (candidates.length === 0 || count <= 0) return []
      const picked: Vec2[] = []
      for (let n = 0; n < count; n++) {
        picked.push(candidates[Math.round(((n + phase) / count) * candidates.length) % candidates.length])
      }
      return picked
    }

    const throughDepth = p.flangeThicknessMM * 2 + 4
    if (p.boltHoleDiameterMM > 0 && p.boltCount > 0) {
      for (const [x, y] of spread(p.boltCount, 0)) {
        const bolt = outOfPartingFrame(
          k(k(Manifold.cylinder(throughDepth, p.boltHoleDiameterMM / 2, -1, CIRCLE_SEGMENTS))
            .translate([x, y, partingOffset - throughDepth / 2])),
        )
        front = k(front.subtract(bolt))
        back = k(back.subtract(bolt))
      }
    }

    // Two keys, half a turn apart, so the halves can only close one way.
    if (p.registrationPinDiameterMM > 0 && p.registrationPinDepthMM > 0) {
      // Half a step out of phase with the bolts, so a pin never lands where a
      // bolt hole is about to be drilled through it.
      const keys = spread(Math.max(2, p.boltCount), 0.5)
      for (const [x, y] of [keys[0], keys[Math.floor(keys.length / 2)]]) {
        const radius = p.registrationPinDiameterMM / 2
        // Pin grows out of the front half into the back half's socket, and has to
        // reach back *past* the parting plane to do it: a pin that merely touches
        // the plane meets the flange over zero thickness, which Manifold reads as a
        // separate solid — so it survives as a loose crumb at best, and the
        // fragment cleanup below deletes it at worst.
        const embed = Math.min(1.5, p.flangeThicknessMM / 2)
        // Narrow end leads, so it finds the socket instead of jamming on the rim.
        const pin = outOfPartingFrame(
          k(k(Manifold.cylinder(p.registrationPinDepthMM + embed, radius * 0.8, radius, CIRCLE_SEGMENTS))
            .translate([x, y, partingOffset - p.registrationPinDepthMM])),
        )
        // The socket has to break *past* the parting plane for the same reason the
        // pin does, and it is the easier one to get wrong: a mouth that stops flush
        // with the plane caps the void with a zero-thickness coplanar lid, which
        // Manifold reads as an enclosed cavity rather than an opening. decompose()
        // then hands the void back as its own negative-volume piece and the crumb
        // filter deletes it — refilling the socket, so the cones meet solid flange
        // and hold the seam open. The overshoot only ever cuts the half that stops
        // at the plane, so it removes nothing extra.
        const socketDepth = p.registrationPinDepthMM + 0.4
        const socketLowR = radius * 0.8 + p.registrationClearanceMM
        const socketHighR = radius + p.registrationClearanceMM
        const mouth = socketDepth + SOCKET_OVERSHOOT
        // Taper carried on at its own slope rather than restretched over the longer
        // cone, so the clearance over the pin stays exactly what it was designed as.
        const socketSlope = (socketHighR - socketLowR) / socketDepth
        const socket = outOfPartingFrame(
          k(k(Manifold.cylinder(
            mouth,
            socketLowR,
            socketLowR + socketSlope * mouth,
            CIRCLE_SEGMENTS,
          )).translate([x, y, partingOffset - socketDepth])),
        )
        front = k(front.add(pin))
        back = k(back.subtract(socket))
      }
    }
  }

  // ── Pour opening and vents, down through the standing pad ──
  const boreTop = padTopZ + 1
  // Whatever the bores take out of the jacket is what silicone stands in once the
  // pour reaches the pad, so it is measured rather than worked out from the
  // cylinders: only the stretch actually passing through jacket material counts,
  // and the run inside the cavity is already in the field's own figure.
  const solidBeforeBores = front.volume() + back.volume()

  // Only the top of the cavity is ever in question here, and intersecting a column
  // against the whole marched skin is expensive — so the search runs against a slab
  // off its crown instead.
  const crown = k(cavity.trimByPlane([0, 0, 1], cavityTopZ - CROWN_SLAB_MM))

  const slabFloor = cavityTopZ - CROWN_SLAB_MM

  /**
   * How low a bore has to start for the whole of its mouth to open into the cavity,
   * or null when part of that mouth has no cavity under it at all.
   *
   * The number wanted is the *lowest* the cavity's roof gets anywhere inside the
   * bore's circle, not the highest. A dome falls away from its crest, so a flat
   * bottom set just under the highest point still leaves the rest of the circle
   * roofed over: the hole reads as round from the pad and opens as a crescent on the
   * inside. Going by the lowest point instead costs a millimetre or two of extra
   * depth and nothing else — the material under it is cavity, which is already void,
   * so the silicone skin is not touched by cutting past it.
   *
   * It is read off the leftover of the column once the cavity is taken out of it:
   * the piece still reaching the top of the column is the cap the bore has to get
   * through, and the underside of that cap is the roof at its lowest.
   */
  const boreFloor = (x: number, y: number, radius: number): number | null => {
    const column = k(k(Manifold.cylinder(boreTop - slabFloor, radius, -1, 24))
      .translate([x, y, slabFloor]))
    const cap = k(column.subtract(crown))
    const pieces = cap.decompose()
    for (const piece of pieces) k(piece)
    const capPiece = pieces.find((piece) => piece.boundingBox().max[2] > boreTop - 0.5)
    if (!capPiece) return null
    const underside = capPiece.boundingBox().min[2]
    // A cap that runs the whole depth of the slab never sat on the dome at all: some
    // of the circle overhangs the cavity, and boring deep enough to open it would
    // come out of the side of the jacket rather than into the mould.
    return underside <= slabFloor + 0.01 ? null : underside
  }

  /** Smallest share of any bore's mouth that came out open. Reported rather than
   *  trusted: the depth above is meant to guarantee it, and this is what says so. */
  let worstMouth = 1

  /** Bores a channel from under the cavity's roof up through the pad. */
  const bore = (x: number, y: number, radius: number, segments: number, split = false): boolean => {
    const floor = boreFloor(x, y, radius)
    if (floor === null) return false
    // Dropped clear of the roof so the break-through is an opening rather than a
    // tangent kiss along the rim.
    const from = floor - BREAK_THROUGH_MM
    const channel = (side: 1 | -1) => k(k(Manifold.cylinder(boreTop - from, radius, -1, segments))
      .translate([
        x + (split ? normalX * SPLIT_BORE_NUDGE_MM * side : 0),
        y + (split ? normalY * SPLIT_BORE_NUDGE_MM * side : 0),
        from,
      ]))
    front = k(front.subtract(channel(1)))
    back = k(back.subtract(channel(-1)))

    // How much of the mouth is really open: a disc across the bore at its floor,
    // less whatever of it is still outside the cavity. One number, and the one that
    // says whether the hole is a hole or a dimple with a crescent at the bottom.
    const disc = k(k(Manifold.cylinder(0.2, radius, -1, segments)).translate([x, y, from]))
    const roofed = k(disc.subtract(crown))
    worstMouth = Math.min(worstMouth, 1 - roofed.volume() / disc.volume())
    return true
  }

  let sprues = 0
  let sprueTarget = 0
  let vents = 0
  let ventTarget = 0

  if (p.sprueDiameterMM > 0) {
    const radius = p.sprueDiameterMM / 2
    // Held clear of the parting plane by its own radius plus a millimetre, so the
    // bore is a clean round hole in one half rather than two half-channels that have
    // to meet.
    const nudge = radius + 1
    const at = (offset: number) => [centreX + normalX * offset, centreY + normalY * offset] as const
    if (p.sprueMode === 'split') {
      // Centred on the plane: each half carries a half-channel.
      sprueTarget = 1
      if (bore(centreX, centreY, radius, CIRCLE_SEGMENTS, true)) sprues++
    } else if (p.sprueMode === 'pair') {
      sprueTarget = 2
      for (const side of [1, -1] as const) {
        const [x, y] = at(nudge * side)
        if (bore(x, y, radius, CIRCLE_SEGMENTS)) sprues++
      }
    } else {
      sprueTarget = 1
      const [x, y] = at(nudge)
      if (bore(x, y, radius, CIRCLE_SEGMENTS)) sprues++
    }
  }

  if (p.ventDiameterMM > 0) {
    // One vent either side of the seam, spread along it: placed relative to the
    // parting plane rather than to X and Y, so a diagonal bearing doesn't leave both
    // of them in the same half or sitting on the plane itself.
    //
    // Air collects against the outermost roof it can reach, so each vent wants to be
    // as far out along the seam as the cavity still runs. The reach is walked inward
    // from the pad's edge until the column finds cavity beneath it — a fixed reach
    // is what left them drilling into solid jacket.
    const radius = p.ventDiameterMM / 2
    const clear = radius + 0.5
    ventTarget = 2
    for (const side of [1, -1] as const) {
      for (let reach = p.standSquareSideMM / 2 - clear; reach >= clear; reach -= VENT_STEP_MM) {
        const x = centreX + tangent[0] * reach * side + normalX * clear * side
        const y = centreY + tangent[1] * reach * side + normalY * clear * side
        if (bore(x, y, radius, 16)) { vents++; break }
      }
    }
  }

  const boreExtraMM3 = Math.max(0, solidBeforeBores - (front.volume() + back.volume()))

  const frontPiece = dropCrumbs(Manifold, front, k)
  const backPiece = dropCrumbs(Manifold, back, k)
  arena.release(frontPiece, backPiece, seatPocket)
  return {
    front: frontPiece, back: backPiece, seatPocket, sealHalfExtentMM,
    brimExtraMM3, boreExtraMM3, partingOffset, padTopZ,
    boresPlaced: { sprues, sprueTarget, vents, ventTarget, worstMouth },
  }
}

/** Furthest the box reaches from the Z axis in either horizontal direction. */
function halfExtentOf(box: Box): number {
  return Math.max(-box.min[0], box.max[0], -box.min[1], box.max[1])
}

/** Below this share of the largest piece, a disconnected lump is noise, not a part. */
const CRUMB_FRACTION = 0.01

/**
 * Drops disconnected specks while keeping every piece that carries real volume.
 *
 * Marching tetrahedra over a dense scan occasionally sheds a stray blob a
 * millimetre or two across — a fleck of noise in the source mesh resolving into
 * its own island, which would otherwise export as a crumb the slicer dutifully
 * builds. Keeping only the *largest* piece would be the simpler rule and is the
 * wrong one: anything deliberately added that happens not to fuse — a registration
 * pin, say — vanishes without a word.
 */
function dropCrumbs(
  Manifold: ManifoldToplevel['Manifold'],
  part: Manifold,
  k: <T extends { delete(): void }>(v: T) => T,
): Manifold {
  const pieces = part.decompose()
  for (const piece of pieces) k(piece)
  if (pieces.length <= 1) return part

  // decompose() reports an enclosed void as a piece of its own, with negative
  // volume. A hole is not a crumb: rebuilding from the positive pieces alone fills
  // it in, silently and without a word, which is exactly how the registration
  // sockets used to disappear. A part carrying one is left alone — shipping a stray
  // speck is the cheaper mistake by far.
  if (pieces.some((piece) => piece.volume() < 0)) return part

  const largest = Math.max(...pieces.map((piece) => piece.volume()))
  const keep = pieces.filter((piece) => piece.volume() >= largest * CRUMB_FRACTION)
  if (keep.length === pieces.length) return part
  return keep.length === 1 ? keep[0] : k(Manifold.union(keep))
}

/** The outline with the most points — the jacket's silhouette, not a stray island. */
function longestContour(section: CrossSection): Vec2[] {
  const polygons = section.toPolygons()
  let best: Vec2[] = []
  for (const polygon of polygons) if (polygon.length > best.length) best = polygon as Vec2[]
  return best
}

/**
 * `count` points spread evenly along a closed path by arc length. `phase` shifts
 * the whole set by that fraction of one step.
 */
function samplePath(path: Vec2[], count: number, phase = 0): Vec2[] {
  const cumulative: number[] = [0]
  for (let i = 1; i <= path.length; i++) {
    const a = path[i - 1]
    const b = path[i % path.length]
    cumulative.push(cumulative[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = cumulative[path.length]

  const points: Vec2[] = []
  for (let n = 0; n < count; n++) {
    const target = (((n + phase) % count) / count) * total
    let seg = 1
    while (seg < path.length && cumulative[seg] < target) seg++
    const spanStart = cumulative[seg - 1]
    const spanLength = cumulative[seg] - spanStart || 1
    const t = (target - spanStart) / spanLength
    const a = path[seg - 1]
    const b = path[seg % path.length]
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return points
}
