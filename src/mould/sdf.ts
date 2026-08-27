import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export interface DistanceGrid {
  /** Signed distance samples, positive inside the master. x varies fastest. */
  data: Float32Array
  nx: number
  ny: number
  nz: number
  /** World position of sample (0, 0, 0). */
  originX: number
  originY: number
  originZ: number
  spacing: number
}

/** Anything past the measured band reads as uniformly far outside. */
const FAR = 1e4

/**
 * Samples a signed distance field around a triangle mesh, positive inside.
 *
 * The master is deliberately treated as a triangle soup rather than a solid:
 * downloaded statue STLs are routinely non-manifold, and closest-point queries
 * work fine on soup where a boolean library would refuse the file outright.
 *
 * Inside/outside comes from connectivity, not from surface normals. Testing the
 * closest triangle's normal is the obvious approach and it fails badly on exactly
 * the models this tool is for: a figure assembled from overlapping parts has
 * surfaces buried inside solid material, and points near those get told they are
 * outside. That punches bubbles through the offset surfaces and sheds the jacket
 * into loose fragments. Instead the far exterior is flood-filled inwards from the
 * edge of the grid, treating the thin layer of cells that straddle the surface as
 * a barrier the fill cannot cross — so "outside" means "reachable from outside",
 * which no amount of interior geometry can confuse.
 *
 * Samples further than `band` from the surface are clamped rather than measured:
 * the BVH rejects those at the root, which is what keeps this to seconds rather
 * than minutes.
 */
export function buildDistanceGrid(
  geometry: THREE.BufferGeometry,
  bounds: THREE.Box3,
  spacing: number,
  band: number,
  onProgress?: (fraction: number) => void,
): DistanceGrid {
  const bvh = new MeshBVH(geometry)

  const size = new THREE.Vector3()
  bounds.getSize(size)
  const nx = Math.max(2, Math.ceil(size.x / spacing) + 1)
  const ny = Math.max(2, Math.ceil(size.y / spacing) + 1)
  const nz = Math.max(2, Math.ceil(size.z / spacing) + 1)
  const cells = nx * ny * nz
  const data = new Float32Array(cells)

  const point = new THREE.Vector3()
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        point.set(bounds.min.x + i * spacing, bounds.min.y + j * spacing, bounds.min.z + k * spacing)
        const hit = bvh.closestPointToPoint(point, target, 0, band)
        data[(k * ny + j) * nx + i] = hit ? target.distance : FAR
      }
    }
    onProgress?.(((k + 1) / nz) * 0.9)
  }

  // One cell either side of the surface is enough of a barrier for a 6-connected
  // fill, and keeping it that thin means the sign stays right up to within a cell
  // of the surface — far closer than any level set we take.
  const barrier = spacing * 1.01
  const outside = floodFillExterior(data, nx, ny, nz, barrier)
  for (let n = 0; n < cells; n++) if (outside[n]) data[n] = -data[n]
  onProgress?.(1)

  return {
    data, nx, ny, nz,
    originX: bounds.min.x, originY: bounds.min.y, originZ: bounds.min.z,
    spacing,
  }
}

/**
 * Marks every cell reachable from the edge of the grid without stepping onto a
 * cell within `barrier` of the surface. Iterative, with an explicit stack — a
 * recursive fill blows the stack at these grid sizes.
 */
function floodFillExterior(
  distance: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  barrier: number,
): Uint8Array {
  const reached = new Uint8Array(distance.length)
  const stack = new Int32Array(distance.length)
  let top = 0

  const push = (i: number, j: number, k: number) => {
    const slot = (k * ny + j) * nx + i
    if (reached[slot] || distance[slot] <= barrier) return
    reached[slot] = 1
    stack[top++] = slot
  }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      push(0, j, k)
      push(nx - 1, j, k)
    }
    for (let i = 0; i < nx; i++) {
      push(i, 0, k)
      push(i, ny - 1, k)
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      push(i, j, 0)
      push(i, j, nz - 1)
    }
  }

  while (top > 0) {
    const slot = stack[--top]
    const i = slot % nx
    const j = Math.floor(slot / nx) % ny
    const k = Math.floor(slot / (nx * ny))
    if (i > 0) push(i - 1, j, k)
    if (i < nx - 1) push(i + 1, j, k)
    if (j > 0) push(i, j - 1, k)
    if (j < ny - 1) push(i, j + 1, k)
    if (k > 0) push(i, j, k - 1)
    if (k < nz - 1) push(i, j, k + 1)
  }

  return reached
}

/**
 * Trilinear sampler over the grid, in the shape Manifold's levelSet wants
 * (positive inside). Reading a cached grid rather than re-querying the BVH is
 * what makes three level sets cost barely more than one.
 */
export function sampler(grid: DistanceGrid): (p: [number, number, number]) => number {
  const { data, nx, ny, nz, originX, originY, originZ, spacing } = grid
  const at = (i: number, j: number, k: number) => data[(k * ny + j) * nx + i]

  return ([x, y, z]) => {
    const fx = (x - originX) / spacing
    const fy = (y - originY) / spacing
    const fz = (z - originZ) / spacing
    // Outside the sampled box there is nothing but empty space, and saying so
    // explicitly stops the level set closing itself off against the grid wall.
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return -FAR

    const i0 = Math.min(nx - 2, Math.floor(fx))
    const j0 = Math.min(ny - 2, Math.floor(fy))
    const k0 = Math.min(nz - 2, Math.floor(fz))
    const tx = fx - i0
    const ty = fy - j0
    const tz = fz - k0

    const c00 = at(i0, j0, k0) * (1 - tx) + at(i0 + 1, j0, k0) * tx
    const c10 = at(i0, j0 + 1, k0) * (1 - tx) + at(i0 + 1, j0 + 1, k0) * tx
    const c01 = at(i0, j0, k0 + 1) * (1 - tx) + at(i0 + 1, j0, k0 + 1) * tx
    const c11 = at(i0, j0 + 1, k0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1, k0 + 1) * tx

    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz
  }
}

/**
 * Volume in mm³ of the region where the field sits above `level` and above
 * `minZ`, by counting cells.
 *
 * Used for the silicone estimate. The alternative is to march a third level set
 * just to measure it, which costs a full extra mesh in the WASM heap at the exact
 * moment the two that matter are already resident — and the answer is a figure to
 * mix by, where a percent either way is noise.
 */
export function occupiedVolume(
  grid: DistanceGrid,
  level: number | ((z: number) => number),
  minZ: number,
): number {
  const { data, nx, ny, nz, originZ, spacing } = grid
  const cell = spacing ** 3
  let occupancy = 0
  for (let k = 0; k < nz; k++) {
    const z = originZ + k * spacing
    if (z < minZ) continue
    const plane = k * ny
    for (let j = 0; j < ny; j++) {
      const row = (plane + j) * nx
      for (let i = 0; i < nx; i++) {
        // Cells straddling the surface count for the fraction they actually fill.
        // Counting them all-or-nothing biases a 3mm shell low by around a tenth,
        // which is the wrong direction to be wrong in when it tells you how much
        // silicone to mix.
        const threshold = typeof level === 'function' ? level(z) : level
        const excess = (data[row + i] - threshold) / spacing + 0.5
        occupancy += excess <= 0 ? 0 : excess >= 1 ? 1 : excess
      }
    }
  }
  return occupancy * cell
}
