// Client-half smoke harness — no dependencies, plain `node scripts/client-harness.mjs`.
//
// WHY THIS EXISTS: `client.js` is a hand-written bundle for dsh's browser module
// system, so nothing type-checks it against the harness it runs inside. When dsh
// moved every Host capability from `ctx.connection.api` onto the typed Remote
// face (`ctx.remote.<ns>.<method>()` answering a RemoteResult), the Ollama
// settings section kept compiling and booting while its first data call threw,
// which surfaced only as "the Ollama panel will not open".
//
// The harness registers the bundle exactly as the browser does
// (`window.__ModuleLoader__.load` + `factory(require)`), applies it to a fake
// client context whose Connection handle deliberately carries NO `api`, and then
// drives the settings section's own call sequence against a fake Remote face.
import { readFileSync } from 'node:fs'

const SRC = new URL('../client.js', import.meta.url)

// Minimal React stand-in: the bundle only needs the hooks to exist at factory
// time (this harness drives the data path, it never renders).
const react = {
	createElement: () => null,
	Fragment: Symbol('Fragment'),
	useState: () => [undefined, () => {}],
	useEffect: () => {},
	useRef: () => ({ current: undefined }),
	useSyncExternalStore: () => undefined
}
const primitives = { Modal: () => null, Button: () => null, IconPlusOutline16: () => null }

let registration
globalThis.window = { __ModuleLoader__: { load: (r) => { registration = r } } }
// The icon-copy effect and the CSS injector both guard on `document`.
globalThis.document = undefined
new Function(readFileSync(SRC, 'utf8'))()
if (registration === undefined) throw new Error('client.js did not register a bundle')

const mod = registration.factory((spec) => {
	if (spec === 'react') return react
	if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives
	throw new Error(`client.js required an unexpected module: ${spec}`)
})

const calls = []
const ok = (value) => Promise.resolve({ ok: true, value })
const fail = (code, message) => Promise.resolve({ ok: false, error: { code, message } })

const NAMESPACE_VIEW = {
	ns: 'llm-ollama',
	schema: {},
	value: { providers: { ollama: { baseURL: 'http://127.0.0.1:11434', models: [{ id: 'qwen3', contextWindow: 32768 }] } } },
	applies: 'live',
	secrets: [],
	revision: 7
}

let mutateOutcome = ok({ ...NAMESPACE_VIEW, revision: 8 })
const remote = {
	settings: {
		describe: () => { calls.push(['settings.describe']); return ok({ writable: true, hasDocument: true, namespaces: [NAMESPACE_VIEW] }) },
		mutate: (ns, ops, expectedRevision) => { calls.push(['settings.mutate', ns, ops, expectedRevision]); return mutateOutcome }
	},
	credentials: {
		set: (ref, value) => { calls.push(['credentials.set', ref, value]); return ok(undefined) },
		unset: (ref) => { calls.push(['credentials.unset', ref]); return ok(undefined) }
	},
	llm: {
		listConfigurableProviders: () => {
			calls.push(['llm.listConfigurableProviders'])
			return ok([{ provider: 'ollama', displayName: 'Ollama', settingsNs: 'llm-ollama', settingsPath: ['providers'] }])
		},
		listProviders: () => ok([{ id: 'ollama', name: 'Ollama' }]),
		discoverModels: (settingsNs, request) => {
			calls.push(['llm.discoverModels', settingsNs, request])
			return ok([{ id: 'qwen3', name: 'qwen3' }, { id: 'llama3' }])
		}
	},
	$on: () => () => {}
}

// cordis guards every tracked property: reading a Remote namespace the plugin
// did not declare in its `inject` list throws
// `cannot get property "remote.settings" without inject`, and the slots runtime
// answers that throw by abdicating the entry — a blank panel with no visible
// error. Reproduce the guard so a missing declaration fails here instead.
const declared = new Set(mod.inject)
const guardedRemote = new Proxy(remote, {
	get: (target, prop) => {
		if (typeof prop === 'symbol' || prop.startsWith('$')) return Reflect.get(target, prop)
		if (!declared.has(`remote.${String(prop)}`)) throw new Error(`cannot get property "remote.${String(prop)}" without inject`)
		return Reflect.get(target, prop)
	}
})

const sections = []
const ctx = {
	effect: (fn) => { fn(); return () => {} },
	on: () => () => {},
	locale: { register: () => () => {}, bind: () => (key) => key, subscribe: () => () => {} },
	// The current Connection handle: generation/state/reconnect only — the
	// `api` field the section used to read is gone.
	get: (name) => name === 'connection' ? { isLoopback: true, reconnect() {} } : name === 'commandUi' ? { register: () => () => {} } : undefined,
	remote: guardedRemote,
	slots: {
		inject: (name, register) => { register(); return () => {} },
		register: (options) => { if (options.name === 'settings.section') sections.push(options); return () => {} }
	}
}

mod.apply(ctx)

const assertions = []
const check = (label, condition, detail) => assertions.push([label, Boolean(condition), detail])

const section = sections.find((options) => options.id === 'ollama')
check('registers the "ollama" settings.section entry', section !== undefined)
const api = section?.inject().api

// Every Remote namespace the adapter touches must be declared, or cordis throws
// on the property read (the guarded remote above enforces the same rule).
for (const namespace of ['settings', 'llm', 'credentials']) {
	check(`inject declares remote.${namespace}`, mod.inject.includes(`remote.${namespace}`), mod.inject.join(', '))
}

const settingsRes = await api.settings.describe({})
check('settings.describe answers the {result} envelope', settingsRes.result.ok === true)
check('settings.describe carries namespaces + writable',
	Array.isArray(settingsRes.result.value.namespaces) && settingsRes.result.value.writable === true)

const providersRes = await api.llm.providers({})
check('llm.providers answers the configurable-provider directory',
	providersRes.result.ok === true && providersRes.result.value.providers[0]?.settingsNs === 'llm-ollama')

// The section's own row join, to prove the two answers line up.
const view = settingsRes.result.value.namespaces.find((candidate) => candidate.ns === 'llm-ollama')
const routes = new Set(providersRes.result.value.providers.filter((entry) => entry.settingsNs === 'llm-ollama').map((entry) => entry.provider))
for (const route of Object.keys(view?.value?.providers ?? {})) routes.add(route)
check('row join yields the configured route', [...routes].join(',') === 'ollama', [...routes].join(','))

const discovery = await api.llm.discoverModels({ settingsNs: 'llm-ollama', baseURL: 'http://127.0.0.1:11434', api: 'ollama-chat' })
check('llm.discoverModels nests the list under models',
	discovery.result.ok === true && discovery.result.value.models.length === 2)
check('llm.discoverModels passes the settings namespace positionally',
	JSON.stringify(calls.find((c) => c[0] === 'llm.discoverModels')) === JSON.stringify(['llm.discoverModels', 'llm-ollama', { baseURL: 'http://127.0.0.1:11434', api: 'ollama-chat' }]))

const ops = [{ op: 'set', path: ['providers', 'ollama'], value: {} }]
await api.settings.mutate({ ns: 'llm-ollama', ops, expectedRevision: 7 })
check('settings.mutate maps ns/ops/expectedRevision positionally',
	JSON.stringify(calls.find((c) => c[0] === 'settings.mutate')) === JSON.stringify(['settings.mutate', 'llm-ollama', ops, 7]))

await api.credentials.set({ ref: 'OLLAMA_API_KEY', value: 'secret' })
await api.credentials.unset({ ref: 'OLLAMA_API_KEY' })
check('credentials.set/unset map the ref positionally',
	JSON.stringify(calls.filter((c) => c[0].startsWith('credentials'))) === JSON.stringify([['credentials.set', 'OLLAMA_API_KEY', 'secret'], ['credentials.unset', 'OLLAMA_API_KEY']]))

mutateOutcome = fail('settings/conflict', 'stale revision')
const conflicted = await api.settings.mutate({ ns: 'llm-ollama', ops: [], expectedRevision: 3 })
check('a stale write is recognised as a conflict',
	conflicted.result.ok === false && conflicted.result.error.code === 'settings/conflict')

let failed = 0
for (const [label, pass, detail] of assertions) {
	if (!pass) failed += 1
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
}
console.log(failed === 0 ? `\nall ${String(assertions.length)} checks passed` : `\n${String(failed)} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
