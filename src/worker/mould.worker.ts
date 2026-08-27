/// <reference lib="webworker" />
import { buildMould, type MouldResult } from '../mould/pipeline'
import type { MouldParams } from '../mould/params'

export interface WorkerRequest {
  buffer: ArrayBuffer
  params: MouldParams
}

export type WorkerResponse =
  | { kind: 'progress'; stage: string; fraction: number }
  | { kind: 'done'; result: SerialisedResult }
  | { kind: 'error'; message: string }

/** MouldResult with the Manifold handles dropped — only transferable data crosses. */
export interface SerialisedResult {
  parts: Array<{ name: string; positions: Float32Array; stl: ArrayBuffer }>
  masterPositions: Float32Array
  stats: MouldResult['stats']
  notes: string[]
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const post = (message: WorkerResponse) => self.postMessage(message)
  try {
    const result = await buildMould(event.data.buffer, event.data.params, (stage, fraction) =>
      post({ kind: 'progress', stage, fraction }),
    )
    const payload: SerialisedResult = {
      parts: result.parts.map((p) => ({ name: p.name, positions: p.soup.positions, stl: p.stl })),
      masterPositions: result.masterPositions,
      stats: result.stats,
      notes: result.notes,
    }
    // Hand the big buffers over rather than cloning them — a detailed statue's
    // jacket runs to tens of megabytes.
    const transfers: Transferable[] = [
      payload.masterPositions.buffer as ArrayBuffer,
      ...payload.parts.flatMap((p) => [p.positions.buffer as ArrayBuffer, p.stl]),
    ]
    self.postMessage({ kind: 'done', result: payload } satisfies WorkerResponse, transfers)
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
