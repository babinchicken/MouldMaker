import { useCallback, useMemo, useRef, useState } from 'react'
import Controls from './ui/Controls'
import Viewer, { type ViewerPart } from './ui/Viewer'
import { DEFAULT_PARAMS, type MouldParams } from './mould/params'
import type { SerialisedResult, WorkerRequest, WorkerResponse } from './worker/mould.worker'

/**
 * Rounds up to a figure worth reading at a glance.
 *
 * Always up, never down: this is a number someone mixes to, and the error that
 * matters is the one that leaves you short halfway through a pour.
 */
function roundUp(value: number): number {
  const step = value >= 100 ? 10 : value >= 20 ? 5 : value >= 5 ? 1 : 0.5
  return Math.ceil(value / step) * step
}

const PART_COLOURS: Record<string, number> = {
  'master-with-base.stl': 0xd8b45a,
  'jacket-front.stl': 0x6f8cc4,
  'jacket-back.stl': 0x4f6699,
}

export default function App() {
  const [params, setParams] = useState<MouldParams>(DEFAULT_PARAMS)
  const [result, setResult] = useState<SerialisedResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [fraction, setFraction] = useState(0)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [ghostMaster, setGhostMaster] = useState(true)
  const [fileName, setFileName] = useState('')
  const sourceFile = useRef<{ name: string; buffer: ArrayBuffer } | null>(null)

  const run = useCallback((buffer: ArrayBuffer, next: MouldParams) => {
    setBusy(true)
    setError('')
    setStage('Starting')
    setFraction(0)

    const worker = new Worker(new URL('./worker/mould.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.kind === 'progress') {
        setStage(message.stage)
        setFraction(message.fraction)
      } else if (message.kind === 'done') {
        setResult(message.result)
        setBusy(false)
        worker.terminate()
      } else {
        setError(message.message)
        setBusy(false)
        worker.terminate()
      }
    }
    worker.onerror = (event) => {
      setError(event.message || 'The mould worker crashed')
      setBusy(false)
      worker.terminate()
    }
    // The worker consumes the buffer, so hand it a copy and keep the original for
    // the next regeneration.
    const request: WorkerRequest = { buffer: buffer.slice(0), params: next }
    worker.postMessage(request, [request.buffer])
  }, [])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    // Reading a large STL off disk takes a noticeable moment on its own, so show
    // the loader before awaiting rather than only once the worker starts.
    setFileName(file.name)
    setResult(null)
    setError('')
    setBusy(true)
    setStage(`Reading ${file.name}`)
    setFraction(0)
    let buffer: ArrayBuffer
    try {
      buffer = await file.arrayBuffer()
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Could not read that file')
      setBusy(false)
      return
    }
    sourceFile.current = { name: file.name, buffer }
    run(buffer, params)
  }

  const regenerate = () => {
    if (sourceFile.current) run(sourceFile.current.buffer, params)
  }

  const download = (name: string, stl: ArrayBuffer) => {
    const url = URL.createObjectURL(new Blob([stl], { type: 'model/stl' }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  const viewerParts = useMemo<ViewerPart[]>(() => {
    if (!result) return []
    return result.parts.map((part) => ({
      name: part.name,
      positions: part.positions,
      colour: PART_COLOURS[part.name] ?? 0x888888,
      visible: !hidden.has(part.name),
      ghost: part.name !== 'master-with-base.stl' ? ghostMaster : false,
    }))
  }, [result, hidden, ghostMaster])

  const toggle = (name: string) =>
    setHidden((old) => {
      const next = new Set(old)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div className="app">
      <aside>
        <header>
          <h1>Mould Maker</h1>
          <p>
            Drop in a master model and get back a printable kit: the model on a plinth,
            plus a two-part jacket that clamps around it leaving a {params.siliconeThicknessMM}mm
            gap for silicone.
          </p>
        </header>

        <label className="file">
          <input
            type="file"
            accept=".stl"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <span>{fileName || 'Choose an STL…'}</span>
        </label>

        <Controls params={params} onChange={setParams} disabled={busy} />

        <button className="primary" disabled={busy || !sourceFile.current} onClick={regenerate}>
          {busy ? 'Working…' : 'Regenerate'}
        </button>

        {busy && (
          <div className="progress">
            <div className="bar"><span style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
            <small>{stage}</small>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {result && (
          <>
            <div className="group">
              <h3>Parts</h3>
              <label className="check">
                <input type="checkbox" checked={ghostMaster} onChange={(e) => setGhostMaster(e.target.checked)} />
                <span>See through the jacket</span>
              </label>
              {result.parts.map((part) => (
                <div className="part" key={part.name}>
                  <label className="check">
                    <input type="checkbox" checked={!hidden.has(part.name)} onChange={() => toggle(part.name)} />
                    <span>{part.name.replace('.stl', '')}</span>
                  </label>
                  <button onClick={() => download(part.name, part.stl)}>Save</button>
                </div>
              ))}
            </div>

            <div className="group">
              <h3>Numbers</h3>
              <dl>
                <dt>Model</dt>
                <dd>
                  {result.stats.modelWidthMM.toFixed(0)} × {result.stats.modelDepthMM.toFixed(0)} ×{' '}
                  {result.stats.modelHeightMM.toFixed(0)} mm
                </dd>
                <dt>Scaled from</dt>
                <dd>
                  {result.stats.sourceHeightUnits.toPrecision(3)} file units
                  {' '}(×{result.stats.appliedScale.toPrecision(3)})
                </dd>
                <dt>Plinth</dt>
                <dd>{result.stats.plinthSideMM.toFixed(0)} mm square</dd>
                <dt>Silicone needed</dt>
                <dd>{result.stats.siliconeVolumeML.toFixed(0)} ml</dd>
                <dt>Mix about</dt>
                <dd>{Math.ceil(result.stats.siliconeGrams / 5) * 5} g</dd>
                <dt>Jacket</dt>
                <dd>{result.stats.jacketTriangles.toLocaleString()} triangles</dd>
              </dl>
            </div>

            {result.notes.length > 0 && (
              <div className="group notes">
                <h3>Notes</h3>
                {result.notes.map((note) => <p key={note}>{note}</p>)}
              </div>
            )}
          </>
        )}
      </aside>

      <main>
        {viewerParts.length > 0
          ? <Viewer parts={viewerParts} />
          : !busy && <div className="empty"><p>No model loaded</p></div>}

        {result && !busy && (
          <div className="readout">
            <span className="cap">Silicone</span>
            <strong>~{roundUp(result.stats.siliconeVolumeML)} ml</strong>
            <small>about {roundUp(result.stats.siliconeGrams)} g to mix</small>
          </div>
        )}

        {busy && (
          <div className="loading">
            <div className="card">
              <div className="spinner" />
              <strong>{stage}</strong>
              <div className="bar"><span style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
              <small>{Math.round(fraction * 100)}%</small>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
