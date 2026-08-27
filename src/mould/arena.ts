/**
 * Keeps track of Manifold's WASM objects so they can be freed.
 *
 * These are not garbage-collected — every boolean, transform and slice hands back
 * a fresh handle that holds its memory until `delete()` is called on it. Building
 * one jacket half runs it through a dozen or more such handles as bolt holes,
 * vents and the sprue are cut, and each discarded copy is a full jacket. Left
 * alone that fills the WASM heap and the next allocation dies with "memory access
 * out of bounds" — a failure that reads like a size limit but is really a leak.
 */
export class Arena {
  private held: Array<{ delete(): void }> = []

  /** Registers an object and returns it, so it can wrap an expression inline. */
  keep<T extends { delete(): void }>(value: T): T {
    this.held.push(value)
    return value
  }

  /** Frees everything registered so far apart from `survivors`. */
  release(...survivors: Array<{ delete(): void } | null | undefined>): void {
    const keep = new Set(survivors)
    for (const item of this.held) {
      if (keep.has(item)) continue
      // A handle can already be gone — decompose() hands back the original when
      // there is only one piece, so the same object can be registered twice.
      try {
        item.delete()
      } catch {
        // Already freed; nothing to do.
      }
    }
    this.held = []
  }
}
