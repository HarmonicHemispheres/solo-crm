// Boot the BUILT app on a throwaway seeded profile and screenshot every route
// at three widths, over the Chrome DevTools Protocol. This is the visual
// check jsdom cannot do (ADR-016): jsdom computes no layout, so a width,
// overflow or visibility assertion there passes against broken CSS. Two
// defects every jsdom test passed were found by this script's first version
// (T-260828-15): a bar that rendered at 0px, and three stylesheets fighting
// over one unscoped selector.
//
//     npm run build && npm run snap                  every route, shots/
//     npm run snap -- --routes companies,company     only these
//     npm run snap -- --out C:\tmp\shots --widths 1440,700
//
// It never touches the operator's database: --user-data-dir points at a
// fresh temp profile seeded from the dev fixture, which is also why no
// first-run dialog appears. Read the PNGs it writes; the metrics.json beside
// them names anything overflowing the viewport.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const OUT = flag('out', join(REPO, 'shots'))
const WIDTHS = flag('widths', '1440,900,700').split(',').map(Number)
const ONLY = flag('routes', '').split(',').filter(Boolean)
const HEIGHT = 900
const PORT = 9344
const SETTLE_MS = 1400

// Every path in ROUTE_META (electron/renderer/nav.ts), plus the two detail
// pages, which need a real id and are reached by clicking into the first row.
const ROUTES = [
  ['today', '/'],
  ['todos', '/todos'],
  ['revenue', '/revenue'],
  ['activity', '/activity'],
  ['companies', '/companies'],
  ['company', { from: '/companies', match: '/company/' }],
  ['people', '/people'],
  ['person', { from: '/people', match: '/person/' }],
  ['offerings', '/offerings'],
  ['engagements', '/engagements'],
  ['settings', '/workspace/settings'],
  ['data', '/workspace/data']
].filter(([name]) => !ONLY.length || ONLY.includes(name))

if (!existsSync(join(REPO, 'out', 'main', 'index.js'))) {
  console.error('[snap] out/main/index.js is missing — run `npm run build` first')
  process.exit(1)
}

const electron = join(REPO, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const profile = mkdtempSync(join(tmpdir(), 'solo-crm-snap-'))
mkdirSync(OUT, { recursive: true })
const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
console.log(`[snap] profile: ${profile}`)

// --- seed ------------------------------------------------------------------
const seed = spawnSync(electron, [join(REPO, 'out/main/seed.js'), `--user-data-dir=${profile}`], { encoding: 'utf-8', env })
if (seed.status !== 0) {
  console.error(seed.stderr)
  process.exit(1)
}

// --- boot ------------------------------------------------------------------
const app = spawn(electron, [REPO, `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], {
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})
app.stderr.on('data', (d) => {
  const s = String(d)
  if (!/DevTools listening|Autofill|GPU|Vulkan|dbus/i.test(s)) process.stderr.write(`[app] ${s}`)
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (page) return page
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('no page target after 15s')
}

const page = await pageTarget()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
let nextId = 1
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
}
const send = (method, params = {}) => {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
await send('Page.enable')
await send('Runtime.enable')

for (let i = 0; i < 80; i++) {
  if (await evaluate(`!!document.querySelector('.rail') && document.body.textContent.length > 40`)) break
  await sleep(250)
}

async function go(hash) {
  await evaluate(`location.hash = '#${hash}'; window.dispatchEvent(new HashChangeEvent('hashchange'))`)
  await sleep(SETTLE_MS)
}

// Resolve a detail route once: visit the list, click the first record, read
// the hash. Cached so each width does not re-click.
const resolved = new Map()
async function resolveRoute(spec) {
  if (typeof spec === 'string') return spec
  if (resolved.has(spec.match)) return resolved.get(spec.match)
  await go(spec.from)
  const found = await evaluate(`(() => {
    const a = document.querySelector('main a[href*="${spec.match}"]')
    if (a) return a.getAttribute('href').replace(/^#/, '')
    // Grid cards are <button class="ccard">; list rows are focusable <tr>s.
    const el = document.querySelector('main button.ccard, main tbody tr[tabindex]')
    if (el) el.click()
    return null
  })()`)
  if (found) {
    resolved.set(spec.match, found)
    return found
  }
  await sleep(SETTLE_MS)
  const hash = await evaluate(`location.hash.replace(/^#/, '')`)
  if (!hash.includes(spec.match)) return null
  resolved.set(spec.match, hash)
  return hash
}

const results = []
for (const width of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
  for (const [name, spec] of ROUTES) {
    const hash = await resolveRoute(spec)
    if (!hash) {
      console.log(`[snap] ${name}: could not reach a record from ${spec.from}; skipped`)
      continue
    }
    await go(hash)
    const metrics = await evaluate(`(() => {
      const de = document.documentElement
      const overflowing = [...document.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
        .slice(0, 6)
        .map((el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : ''))
      return {
        horizontalScroll: de.scrollWidth > de.clientWidth || document.body.scrollWidth > de.clientWidth,
        overflowing,
        heading: document.querySelector('h1')?.textContent ?? null,
        emptyText: document.querySelector('.empty')?.textContent ?? null
      }
    })()`)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = join(OUT, `${name}-${width}.png`)
    writeFileSync(file, Buffer.from(shot.data, 'base64'))
    results.push({ width, route: name, hash, ...metrics, file })
    console.log(
      `[snap] ${name} @${width}: h1=${JSON.stringify(metrics.heading)} hscroll=${metrics.horizontalScroll}` +
        (metrics.overflowing.length ? ` OVERFLOW:${metrics.overflowing.join(',')}` : '')
    )
  }
}

writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(results, null, 2))
const bad = results.filter((r) => r.horizontalScroll || r.overflowing.length)
console.log(`\n[snap] ${results.length} screenshots in ${OUT}` + (bad.length ? ` — ${bad.length} with overflow, see metrics.json` : ''))

ws.close()
app.kill()
process.exit(0)
