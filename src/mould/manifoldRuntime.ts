import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'

let ready: Promise<ManifoldToplevel> | null = null

/** Boots the Manifold WASM module once and hands the same instance to every caller. */
export function manifoldRuntime(): Promise<ManifoldToplevel> {
  if (!ready) {
    ready = Module({ locateFile: () => wasmUrl }).then((instance) => {
      instance.setup()
      return instance
    })
  }
  return ready
}
