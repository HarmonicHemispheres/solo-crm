// A real-window pass over the built app (T-260828-15, P0-10), driven over
// the Chrome DevTools Protocol.
//
// jsdom certifies structure, not paint — it computes no layout, so a width
// or overflow assertion there measures nothing and passes against broken
// CSS. This boots the ACTUAL app (electron-vite's out/main + out/preload +
// out/renderer, the same entry `npm run dev` uses) against a throwaway,
// freshly seeded profile, then records real geometry and a screenshot per
// route per width.
//
// Two defects that every jsdom test in this repo passed were found this way
// and are fixed on main: DecayMeter's `.fill` was an inline <span>, so
// `width` did not apply and every cadence bar across four views rendered at
// 0px; and three stylesheets declared the same unscoped `.tli` selectors, so
// whichever the bundler emitted last styled all of them.
//
// Deliberately NOT wired into `npm test`. That would be the automated
// visual-regression tooling T-260828-15's scope puts out of bounds ("worth
// its own decision if this pass finds enough" — it did, and that decision is
// still the user's). Run it by hand:
//
//     npm run build && node scripts/window-pass.mjs [outDir]
//
// It never touches the operator's database: --user-data-dir points at a
// fresh temp profile, which is also why no first-run dialog appears (main
// resolves that flow silently when a solocrm.db already exists under the
// resolved root).
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const OUT = process.argv[2] ?? join(REPO, 'shots')
const WIDTHS = [1440, 900, 700]
const HEIGHT = 900
const PORT = 9344

const electron = join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = mkdtempSync(join(tmpdir(), 'solo-crm-qa-'))
mkdirSync(OUT, { recursive: true })
console.log(`[qa] profile: ${profile}`)

// --- seed the throwaway profile -------------------------------------------
const seed = spawnSync(electron, [join(REPO, 'out/main/seed.js'), `--user-data-dir=${profile}`], {
  encoding: 'utf-8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
})
console.log(`[qa] seed exit ${seed.status}`)
console.log((seed.stdout || '').split('\n').filter((l) => l.includes('[seed]')).join('\n'))
if (seed.status !== 0) {
  console.error(seed.stderr)
  process.exit(1)
}

// --- boot the real app ----------------------------------------------------
const app = spawn(
  electron,
  [REPO, `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: ['ignore', 'pipe', 'pipe'] }
)
app.stderr.on('data', (d) => {
  const s = String(d)
  if (!/DevTools listening|Autofill|GPU|Vulkan|dbus/i.test(s)) process.stderr.write(`[app] ${s}`)
})

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (page) return page
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('no page target after 15s')
}

const page = await targets()
console.log(`[qa] attached: ${page.url}`)

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
function send(method, params = {}) {
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

// Wait for the app to have actually painted something real.
for (let i = 0; i < 80; i++) {
  const ready = await evaluate(`!!document.querySelector('.rail') && document.body.textContent.length > 40`)
  if (ready) break
  await new Promise((r) => setTimeout(r, 250))
}

const results = []
const ROUTES = [
  ['today', '/'],
  ['companies', '/companies'],
  ['todos', '/todos']
]

for (const width of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false
  })
  for (const [name, hash] of ROUTES) {
    await evaluate(`location.hash = '#${hash}'; window.dispatchEvent(new HashChangeEvent('hashchange'))`)
    await new Promise((r) => setTimeout(r, 1400))

    const metrics = await evaluate(`(() => {
      const de = document.documentElement
      const body = document.body
      // Anything sticking out past the viewport, named, so a failure says
      // which element rather than only that the number was wrong.
      const overflowing = [...document.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
        .slice(0, 6)
        .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).join('.') : ''))
      const rail = document.querySelector('.rail')
      const railStyle = rail ? getComputedStyle(rail) : null
      return {
        docScrollWidth: de.scrollWidth,
        docClientWidth: de.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        horizontalScroll: de.scrollWidth > de.clientWidth || body.scrollWidth > de.clientWidth,
        overflowing,
        railVisibility: railStyle ? railStyle.visibility : null,
        railLeft: railStyle ? railStyle.left : null,
        accent: getComputedStyle(de).getPropertyValue('--verdigris').trim(),
        bg: getComputedStyle(document.body).backgroundColor,
        heading: (document.querySelector('h1') || {}).textContent ?? null,
        statCount: document.querySelectorAll('.stat').length,
        heroCount: document.querySelectorAll('.stat.hero').length,
        cardCount: document.querySelectorAll('.card').length,
        versionChip: (document.querySelector('.rail .ver') || document.querySelector('.rail-meta') || {}).textContent ?? null,
        errorText: (document.querySelector('.empty') || {}).textContent ?? null
      }
    })()`)

    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = join(OUT, `${name}-${width}.png`)
    writeFileSync(file, Buffer.from(shot.data, 'base64'))

    results.push({ width, route: name, ...metrics, file })
    console.log(
      `[qa] ${name} @${width}: hscroll=${metrics.horizontalScroll} doc=${metrics.docScrollWidth}/${metrics.docClientWidth} rail=${metrics.railVisibility}@${metrics.railLeft} stats=${metrics.statCount} hero=${metrics.heroCount} cards=${metrics.cardCount}` +
        (metrics.overflowing.length ? ` OVERFLOW:${metrics.overflowing.join(',')}` : '')
    )
  }
}

writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(results, null, 2))
console.log(`\n[qa] wrote ${results.length} screenshots + metrics.json to ${OUT}`)

ws.close()
app.kill()
process.exit(0)
