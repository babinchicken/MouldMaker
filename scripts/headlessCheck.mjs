// Runs the real pipeline in Node by bundling it with esbuild and swapping Vite's
// `?url` wasm import for a filesystem path.
import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const wasmPath = path.join(root, 'node_modules/manifold-3d/manifold.wasm')
const out = path.join(process.env.SCRATCH, 'pipeline.mjs')

const wasmUrlPlugin = {
  name: 'wasm-url',
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: 'wasm-url' }))
    build.onLoad({ filter: /.*/, namespace: 'wasm-url' }, () => ({
      contents: `export default ${JSON.stringify('file://' + wasmPath)}`,
      loader: 'js',
    }))
  },
}

await esbuild.build({
  entryPoints: [path.join(root, 'scripts/entry.mjs')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  plugins: [wasmUrlPlugin], logLevel: 'error', external: ['node:*'],
})

const mod = await import(out)
await mod.runCheck(readFileSync(process.argv[2]), writeFileSync)
