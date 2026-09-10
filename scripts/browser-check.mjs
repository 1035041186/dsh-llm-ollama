// Browser check for the Ollama settings section — the tool that catches what no
// static reading can. Run it against a live dsh web instance whenever the
// harness is upgraded:
//
//   1. Isolated instance (never touches your own $DSH_HOME):
//        DSH_HOME=$PWD/.diag/home dsh --profile web --port 3099 --no-open
//      with $DSH_HOME/profiles/web/package.json listing the bundles
//      (dsh-base, dsh-web-app, and this package) and
//      $DSH_HOME/profiles/web/node_modules/@zhangyi/dsh-llm-ollama symlinked here.
//   2. node scripts/browser-check.mjs --url 'http://127.0.0.1:3099/?token=…' [--save]
//
// It opens Settings → Ollama in a real Chromium, dumps what the panel rendered,
// and fails on any console error or on an abdicated slot entry. That last part
// matters: the slots runtime swallows a crashing entry and renders NOTHING, so a
// broken panel looks like an empty panel and the browser console is the only
// place the real error appears.
//
// Overrides: CHROME_PATH (headless shell binary) and PLAYWRIGHT_CORE (module
// path or specifier).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')

const args = process.argv.slice(2)
const valueOf = (flag) => {
	const index = args.indexOf(flag)
	return index === -1 ? undefined : args[index + 1]
}
const url = valueOf('--url')
if (url === undefined) throw new Error('usage: node scripts/browser-check.mjs --url <tokenized dsh web url> [--save] [--shot <path>]')
const executablePath = valueOf('--chrome') ?? process.env.CHROME_PATH
const shot = valueOf('--shot')
const alsoSave = args.includes('--save')

const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(`[console.error] ${message.text()}`) })
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`))

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('button', { timeout: 30000 })
await page.waitForTimeout(4000)

// A fresh home opens onboarding first; its mask swallows every other click.
for (const label of [/^configure later$/i, /^continue$/i]) {
	const button = page.getByRole('button', { name: label }).first()
	if ((await button.count()) > 0) {
		await button.click({ force: true }).catch(() => {})
		await page.waitForTimeout(1200)
	}
}

await page.getByRole('button', { name: /^settings$/i }).first().click({ force: true })
await page.waitForTimeout(1500)
const nav = page.getByRole('button', { name: /^ollama$/i }).first()
if ((await nav.count()) === 0) throw new Error('no "Ollama" entry in the settings navigation — the client bundle did not register its section')
await nav.click({ force: true })
await page.waitForTimeout(2500)

if (alsoSave) {
	await page.locator('input[placeholder="ollama"]').first().fill('Local Ollama')
	await page.locator('input[placeholder="http://localhost:11434"]').first().fill('http://127.0.0.1:11434')
	await page.getByRole('button', { name: /^save$/i }).first().click()
	await page.waitForTimeout(2500)
}

const state = await page.evaluate(() => {
	const outlet = document.querySelector('[data-slot="settings.section"]')
	return {
		text: (outlet?.innerText ?? '').replace(/\s+/g, ' ').trim(),
		abdicated: document.querySelector('[data-slot-error="settings.section"]') !== null
	}
})
console.log(`panel renders: ${state.text.length > 0 ? 'yes' : 'NO'}`)
console.log(state.text.slice(0, 800))
if (shot !== undefined) await page.screenshot({ path: shot })

console.log(`browser errors: ${String(errors.length)}`)
for (const error of errors) console.log(error)
await browser.close()

if (state.abdicated || state.text.length === 0) {
	console.error('\nFAIL: the settings.section entry abdicated (blank panel) — see the console errors above')
	process.exit(1)
}
if (errors.length > 0) {
	console.error('\nFAIL: the browser reported errors')
	process.exit(1)
}
console.log('\nOK: the Ollama settings panel rendered with no browser errors')
