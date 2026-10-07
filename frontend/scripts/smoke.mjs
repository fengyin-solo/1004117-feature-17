// 冒烟测试运行器：用 esbuild JS API 打包 smoke-test.ts 后执行（避开平台二进制差异）
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
const outfile = new URL('./node_modules/.cache/smoke-test.mjs', root).pathname

await build({
  entryPoints: [new URL('./smoke-test.ts', root).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': new URL('./src', root).pathname },
  outfile,
  logLevel: 'warning',
})

await import(pathToFileURL(outfile).href)
