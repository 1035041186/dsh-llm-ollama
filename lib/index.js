/**
 * @deepseek-ai/dsh-llm-ollama — Ollama native protocol (/api/chat) provider.
 *
 * Registers an `llm-ollama` settings namespace whose schema offers the
 * `ollama-chat` wire protocol in the Models settings surface (the "Add a
 * custom provider" API-protocol dropdown reads the union straight off this
 * schema), serves configured routes through a custom LlmAdapter that speaks
 * Ollama's native streaming /api/chat, discovers models through /api/tags,
 * and keeps the configurable-provider directory and adapter registrations in
 * sync with the namespace value.
 *
 * Per-model Context window maps to the request's `options.num_ctx` (exactly
 * the value entered) and Max output tokens to `options.num_predict`, so
 * Ollama loads the model with the context the user configured. Provider-level
 * `keepAlive` maps to `keep_alive` and `temperature` to `options.temperature`.
 */
export const name = 'llm-ollama'
export const inject = ['llm', 'settings', 'subprocess']

export function apply(ctx) {
  const OLLAMA_NS = 'llm-ollama'
  const OLLAMA_API = 'ollama-chat'
  const USER_AGENT = 'deepseek-harness (+https://github.com/deepseek-ai/deepseek-harness)'
  const IDLE_TIMEOUT_MS = 300000
  // Default context window for models without an explicit per-model
  // Context window: 32K. Sent as `options.num_ctx` on every /api/chat
  // request unless the model entry overrides it.
  const DEFAULT_CONTEXT_WINDOW = 32768

  // ── helpers ─────────────────────────────────────────────────────────────
  // An Error whose own `code` and `failure` properties agree, so the harness's
  // failure normalizer carries the code/status across the wire.
  function failureError(message, code, status) {
    const error = new Error(message)
    error.code = code
    error.failure = {
      message,
      code,
      ...status === undefined ? {} : { status }
    }
    return error
  }

  // Resolve curl across platforms: a PATH name first (Linux/macOS and modern
  // Windows all ship curl), then the common absolute locations.
  const CURL_CANDIDATES = ['curl', '/usr/bin/curl', 'C:\\Windows\\System32\\curl.exe']
  let curlPath
  let curlUnresolvable = false
  async function resolveCurl(subprocessService) {
    if (curlPath !== undefined) return curlPath
    if (curlUnresolvable) throw new Error('ollama: curl is required but could not be resolved; install curl and restart dsh')
    for (const candidate of CURL_CANDIDATES) {
      try {
        const resolved = await subprocessService.resolveExecutable(candidate)
        if (typeof resolved === 'string' && resolved.length > 0) {
          curlPath = resolved
          return curlPath
        }
      } catch {
        // try the next candidate
      }
    }
    curlUnresolvable = true
    throw new Error('ollama: curl is required but could not be resolved; install curl and restart dsh')
  }

  // Convert harness messages (text / tool calls / tool results) into the
  // Ollama /api/chat message vocabulary.
  function buildMessages(options) {
    const messages = []
    if (options.system !== undefined && options.system.length > 0) {
      messages.push({ role: 'system', content: options.system })
    }
    for (const message of options.messages) {
      const blocks = Array.isArray(message.content) ? message.content : []
      if (message.role === 'system') {
        messages.push({ role: 'system', content: textOfBlocks(blocks) })
        continue
      }
      if (message.role === 'user') {
        const toolResult = blocks.find((block) => block.type === 'tool-result')
        if (toolResult !== undefined) {
          messages.push({
            role: 'tool',
            content: textOfBlocks(toolResult.content),
            tool_call_id: toolResult.toolCallId
          })
          continue
        }
        for (const block of blocks) {
          if (block.type === 'image') {
            throw failureError('ollama: image attachments are not supported by this adapter yet; remove the image and retry', 'UNSUPPORTED_OPTION')
          }
        }
        messages.push({ role: 'user', content: textOfBlocks(blocks) })
        continue
      }
      if (message.role === 'assistant') {
        const text = textOfBlocks(blocks)
        const calls = blocks.filter((block) => block.type === 'tool-call')
        const entry = { role: 'assistant', content: text.length > 0 ? text : '' }
        if (calls.length > 0) {
          entry.tool_calls = calls.map((block) => ({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: block.arguments }
          }))
        }
        messages.push(entry)
        continue
      }
    }
    return messages
  }
  function textOfBlocks(blocks) {
    const parts = []
    for (const block of blocks ?? []) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      }
    }
    return parts.join('\n')
  }

  // ── serialized schemastery envelope for the llm-ollama namespace ────────
  // Mirrors the dsh-llm-pi-ai profile shape (so the Models page renders the
  // same editors) with the api union narrowed to `ollama-chat` plus the
  // Ollama-specific keepAlive / temperature fields.
  const ENVELOPE = {
    uid: 26,
    refs: {
      '1': { type: 'string', meta: { role: 'credential-ref' } },
      '2': { type: 'string', meta: {} },
      '3': { type: 'union', meta: {}, list: [5] },
      '5': { type: 'const', meta: { required: true }, value: 'ollama-chat' },
      '6': { type: 'string', meta: {} },
      '8': { type: 'string', meta: { required: true } },
      '9': { type: 'string', meta: {} },
      '12': { type: 'number', meta: { step: 1, min: 1 } },
      '15': { type: 'number', meta: { step: 1, min: 1 } },
      '16': { type: 'object', meta: { default: {} }, dict: { id: 8, name: 9, contextWindow: 12, maxTokens: 15 } },
      '17': { type: 'array', meta: { default: [] }, inner: 16 },
      '18': { type: 'string', meta: {} },
      '21': { type: 'number', meta: { min: 0, max: 2 } },
      '22': { type: 'object', meta: { default: {} }, dict: { apiKeyEnv: 1, displayName: 2, api: 3, baseURL: 6, models: 17, keepAlive: 18, temperature: 21 } },
      '24': { type: 'string', meta: {} },
      '25': { type: 'dict', meta: { default: {} }, inner: 22, sKey: 24 },
      '26': { type: 'object', meta: { default: {} }, dict: { providers: 25 } }
    }
  }

  // ── manual resolver/validator used as the namespace schema ──────────────
  // Called by the settings service as `schema(mergedValue)`; must validate
  // and return the resolved value. Throws to refuse a write.
  function resolveConfig(raw) {
    const root = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const providersRaw = root.providers !== undefined ? root.providers : {}
    if (providersRaw === null || typeof providersRaw !== 'object' || Array.isArray(providersRaw)) {
      throw new Error('ollama: providers must be an object keyed by provider route')
    }
    const providers = {}
    for (const [route, source] of Object.entries(providersRaw)) {
      if (route.length === 0) throw new Error('ollama: provider names must be non-empty')
      if (source === null || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`ollama: provider "${route}" must be an object`)
      }
      const api = source.api === undefined ? OLLAMA_API : source.api
      if (api !== OLLAMA_API) {
        throw new Error(`ollama: provider "${route}" api must be "${OLLAMA_API}"`)
      }
      if (source.baseURL !== undefined && (typeof source.baseURL !== 'string' || source.baseURL.length === 0)) {
        throw new Error(`ollama: provider "${route}" baseURL must be a non-empty string`)
      }
      if (source.displayName !== undefined && (typeof source.displayName !== 'string' || source.displayName.length === 0)) {
        throw new Error(`ollama: provider "${route}" displayName must be a non-empty string`)
      }
      if (source.apiKeyEnv !== undefined && (typeof source.apiKeyEnv !== 'string' || source.apiKeyEnv.length === 0)) {
        throw new Error(`ollama: provider "${route}" apiKeyEnv must be a non-empty string`)
      }
      let models = []
      if (source.models !== undefined) {
        if (!Array.isArray(source.models)) throw new Error(`ollama: provider "${route}" models must be an array`)
        const seen = new Set()
        for (const [index, model] of source.models.entries()) {
          if (model === null || typeof model !== 'object' || Array.isArray(model)) {
            throw new Error(`ollama: provider "${route}" model ${index} must be an object`)
          }
          if (typeof model.id !== 'string' || model.id.trim().length === 0) {
            throw new Error(`ollama: provider "${route}" model ${index} needs a non-empty id`)
          }
          const id = model.id.trim()
          if (seen.has(id)) throw new Error(`ollama: provider "${route}" lists model "${id}" more than once`)
          seen.add(id)
          if (model.name !== undefined && (typeof model.name !== 'string' || model.name.length === 0)) {
            throw new Error(`ollama: provider "${route}" model "${id}" name must be a non-empty string`)
          }
          for (const field of ['contextWindow', 'maxTokens']) {
            const value = model[field]
            if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)) {
              throw new Error(`ollama: provider "${route}" model "${id}" ${field} must be a positive integer`)
            }
          }
          const next = { id }
          if (model.name !== undefined) next.name = model.name
          if (model.contextWindow !== undefined) next.contextWindow = model.contextWindow
          if (model.maxTokens !== undefined) next.maxTokens = model.maxTokens
          models.push(next)
        }
      }
      const resolved = { api, models }
      if (source.baseURL !== undefined) resolved.baseURL = source.baseURL
      if (source.displayName !== undefined) resolved.displayName = source.displayName
      if (source.apiKeyEnv !== undefined) resolved.apiKeyEnv = source.apiKeyEnv
      if (source.keepAlive !== undefined) {
        if (typeof source.keepAlive !== 'string' || source.keepAlive.length === 0) {
          throw new Error(`ollama: provider "${route}" keepAlive must be a non-empty string like "5m" or "-1"`)
        }
        resolved.keepAlive = source.keepAlive
      }
      if (source.temperature !== undefined) {
        if (typeof source.temperature !== 'number' || !Number.isFinite(source.temperature) || source.temperature < 0 || source.temperature > 2) {
          throw new Error(`ollama: provider "${route}" temperature must be a number between 0 and 2`)
        }
        resolved.temperature = source.temperature
      }
      providers[route] = resolved
    }
    return { providers }
  }
  const schema = Object.assign(resolveConfig, { toJSON: () => ENVELOPE })

  // ── registration lifecycle ──────────────────────────────────────────────
  // The dormant "ollama" route is ALWAYS part of the configurable-provider
  // directory. Besides offering an "Ollama (local)" add-row on the Models page
  // before any configuration exists, it keeps `llm-ollama` inside the web
  // settings proxy's exposed-namespace set (which is derived from the
  // directory), so the API-protocol dropdown and the create/write path reach
  // the namespace even with zero configured profiles.
  const DORMANT_ROUTE = 'ollama'
  const DORMANT_DISPLAY = 'Ollama (local)'

  const scope = ctx.settings.register(OLLAMA_NS, schema, {})
  let profiles = new Map()
  let directoryHandle
  let adapterHandle
  let syncing = false

  function currentProfiles() {
    return profiles
  }
  const adapter = buildAdapter(currentProfiles)

  function syncRegistrations() {
    if (syncing) return
    syncing = true
    try {
      const entries = new Map()
      entries.set(DORMANT_ROUTE, {
        provider: DORMANT_ROUTE,
        displayName: DORMANT_DISPLAY,
        settingsNs: OLLAMA_NS,
        settingsPath: ['providers', DORMANT_ROUTE],
        declared: false
      })
      for (const [route, profile] of profiles) {
        entries.set(route, {
          provider: route,
          displayName: profile.displayName ?? route,
          settingsNs: OLLAMA_NS,
          settingsPath: ['providers', route],
          declared: route === DORMANT_ROUTE ? false : true
        })
      }
      const nextEntries = [...entries.values()]
      if (directoryHandle === undefined) {
        try {
          directoryHandle = ctx.llm.registerConfigurableProviders(nextEntries)
        } catch (error) {
          console.error('ollama: directory registration failed', error)
        }
      } else {
        try {
          directoryHandle.replace(nextEntries)
        } catch (error) {
          console.error('ollama: directory replace failed', error)
        }
      }
      const routes = [...profiles.keys()]
      if (routes.length === 0) {
        if (adapterHandle !== undefined) {
          adapterHandle()
          adapterHandle = undefined
        }
      } else if (adapterHandle === undefined) {
        try {
          adapterHandle = ctx.llm.registerAdapter(routes, adapter)
        } catch (error) {
          console.error('ollama: adapter registration failed; routes kept unregistered', error)
        }
      } else {
        try {
          adapterHandle.replace(routes)
        } catch (error) {
          console.error('ollama: adapter replace failed', error)
        }
      }
    } finally {
      syncing = false
    }
  }

  function refreshProfiles() {
    const value = scope.get()
    const next = new Map()
    for (const [route, profile] of Object.entries(value.providers ?? {})) next.set(route, profile)
    profiles = next
    syncRegistrations()
  }

  // ── model discovery: GET {baseURL}/api/tags ─────────────────────────────
  ctx.llm.registerModelDiscovery(OLLAMA_NS, async (request) => {
    let baseURL = request.baseURL
    if (request.provider !== undefined && baseURL === undefined) {
      baseURL = profiles.get(request.provider)?.baseURL
    }
    const api = request.api ?? OLLAMA_API
    if (api !== OLLAMA_API) {
      throw failureError(`ollama: protocol "${api}" has no readable model listing; use "${OLLAMA_API}"`, 'DISCOVERY_UNSUPPORTED')
    }
    if (baseURL === undefined || baseURL.length === 0) {
      throw failureError('ollama: set a base URL such as http://localhost:11434 to fetch its models', 'DISCOVERY_FAILED')
    }
    const url = `${baseURL.replace(/\/+$/, '')}/api/tags`
    const handle = ctx.subprocess.spawn({
      argv: [await resolveCurl(ctx.subprocess), '-sS', '-f', url, '-H', 'Accept: application/json', '-H', `User-Agent: ${USER_AGENT}`],
      cwd: '/',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 65536 } },
      graceMs: 5000,
      ...request.signal === undefined ? {} : { signal: request.signal }
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (outcome.exitCode !== 0) {
      throw failureError(`ollama: could not reach ${url} (curl exit ${String(outcome.exitCode)}${stderr.length > 0 ? `: ${stderr.trim().slice(0, 300)}` : ''})`, 'DISCOVERY_FAILED')
    }
    let body
    try {
      body = JSON.parse(stdout)
    } catch {
      throw failureError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED')
    }
    if (typeof body.error === 'string' && body.error.length > 0) {
      throw failureError(`ollama: ${body.error}`, 'DISCOVERY_FAILED')
    }
    if (!Array.isArray(body.models)) {
      throw failureError(`${url} answered without a "models" array; enter this provider's models by hand`, 'DISCOVERY_FAILED')
    }
    const models = []
    for (const entry of body.models) {
      const entryName = entry !== null && typeof entry === 'object' ? entry.name : undefined
      if (typeof entryName !== 'string' || entryName.length === 0) continue
      models.push({ id: entryName, name: entryName })
    }
    return models
  })

  refreshProfiles()
  scope.watch(() => refreshProfiles())
  console.log(`llm-ollama: plugin active; ${profiles.size} profile(s)`)

  // ── adapter: Ollama native /api/chat ────────────────────────────────────
  function buildAdapter(getProfilesFn) {
    return {
      providerInfo(provider) {
        const profile = getProfilesFn().get(provider)
        return { id: provider, name: profile?.displayName ?? provider }
      },
      providerRetryPolicy() {
        return undefined
      },
      listModels(provider) {
        const profile = getProfilesFn().get(provider)
        const models = profile?.models ?? []
        return Promise.resolve(models.map((model) => ({
          provider,
          id: model.id,
          name: model.name ?? model.id,
          inputModalities: ['text']
        })))
      },
      resolveModel(provider, model, _signal) {
        const profile = getProfilesFn().get(provider)
        const entry = (profile?.models ?? []).find((candidate) => candidate.id === model)
        const info = {
          provider,
          id: model,
          name: entry?.name ?? model,
          inputModalities: ['text']
        }
        if (entry?.contextWindow !== undefined) info.context = { contextWindow: entry.contextWindow }
        else info.context = { contextWindow: DEFAULT_CONTEXT_WINDOW }
        if (entry?.maxTokens !== undefined) info.defaultMaxTokens = entry.maxTokens
        return Promise.resolve(info)
      },
      async *stream(options) {
        const profile = getProfilesFn().get(options.provider)
        if (profile === undefined) {
          throw failureError(`ollama: no profile for provider "${options.provider}"`, 'NO_ADAPTER')
        }
        const baseURL = profile.baseURL
        if (baseURL === undefined || baseURL.length === 0) {
          throw failureError(`ollama: provider "${options.provider}" has no baseURL; set it on the Models page`, 'INVALID_REQUEST')
        }
        const entry = (profile.models ?? []).find((candidate) => candidate.id === options.model)
        const url = `${baseURL.replace(/\/+$/, '')}/api/chat`
        const body = {
          model: options.model,
          messages: buildMessages(options),
          stream: true
        }
        const tools = options.tools ?? []
        if (tools.length > 0) {
          body.tools = tools.map((toolSchema) => ({
            type: 'function',
            function: {
              name: toolSchema.name,
              description: toolSchema.description,
              parameters: toolSchema.parameters
            }
          }))
        }
        const opts = {}
        // Always send num_ctx: the per-model Context window when set,
        // otherwise the 32K default, so Ollama loads the configured context.
        opts.num_ctx = entry?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
        const numPredict = options.maxTokens ?? entry?.maxTokens
        if (numPredict !== undefined) opts.num_predict = numPredict
        const temperature = options.temperature ?? profile.temperature
        if (temperature !== undefined) opts.temperature = temperature
        if (Object.keys(opts).length > 0) body.options = opts
        if (profile.keepAlive !== undefined) body.keep_alive = profile.keepAlive

        const payload = JSON.stringify(body)
        const handle = ctx.subprocess.spawn({
          argv: [
            await resolveCurl(ctx.subprocess),
            '-sS', '-N', '-X', 'POST', url,
            '-H', 'Content-Type: application/json',
            '-H', 'Accept: application/x-ndjson',
            '-H', `User-Agent: ${USER_AGENT}`,
            '--data-binary', '@-'
          ],
          cwd: '/',
          stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65536 } },
          graceMs: 5000,
          ...options.signal === undefined ? {} : { signal: options.signal }
        })
        try {
          if (handle.stdin === undefined) throw new Error('curl stdin pipe was not allocated')
          handle.stdin.write(payload)
        } catch (error) {
          handle.terminate()
          throw failureError(`ollama: failed to write request to curl: ${error instanceof Error ? error.message : String(error)}`, 'TRANSPORT')
        }
        handle.stdin.end()
        if (handle.stdout === undefined) {
          handle.terminate()
          throw failureError('ollama: curl stdout pipe was not allocated', 'TRANSPORT')
        }

        if (options.signal?.aborted) {
          handle.terminate()
          throw failureError('ollama: request aborted by caller', 'ABORTED')
        }

        // Idle watchdog: terminate curl when no frame arrives for a while.
        const timer = ctx.get('timer')
        let idleDispose
        const arm = () => {
          idleDispose?.()
          if (timer !== undefined) {
            idleDispose = timer.timeout(() => {
              try {
                handle.terminate()
              } catch {
                /* already gone */
              }
            }, IDLE_TIMEOUT_MS)
          }
        }
        const disarm = () => {
          idleDispose?.()
          idleDispose = undefined
        }

        const reader = handle.stdout[Symbol.asyncIterator]()
        let nextIndex = 0
        const order = []
        let textBlock
        const toolBlocks = new Map()
        let pendingFinish
        let pendingUsage
        let doneSeen = false
        let buffer = ''
        const decoder = new TextDecoder()
        const open = (kind) => {
          const block = { index: nextIndex++, kind, text: '', callId: undefined, name: undefined }
          order.push(block)
          return block
        }
        const closeBlock = (block) => {
          if (block.kind === 'tool-call') {
            return { type: 'tool-call', id: block.callId ?? `call_${block.index}`, name: block.name ?? '', arguments: block.text }
          }
          return { type: 'text', text: block.text }
        }
        const mapDoneReason = (reason) => {
          if (reason === 'length') return { kind: 'max-tokens' }
          if (reason === 'tool_calls') return { kind: 'tool-calls' }
          if (reason === 'error') return { kind: 'error', failure: { message: 'ollama: generation failed', code: 'SERVER' } }
          return { kind: 'stop' }
        }

        try {
          for (;;) {
            arm()
            let chunk
            try {
              const next = await reader.next()
              chunk = next.done ? undefined : next.value
            } finally {
              disarm()
            }
            if (chunk === undefined) break
            buffer += decoder.decode(chunk, { stream: true })
            for (;;) {
              const nl = buffer.indexOf('\n')
              if (nl < 0) break
              const line = buffer.slice(0, nl).trim()
              buffer = buffer.slice(nl + 1)
              if (line.length === 0) continue
              let data
              try {
                data = JSON.parse(line)
              } catch {
                throw failureError(`ollama: malformed stream line: ${line.slice(0, 120)}`, 'MALFORMED_RESPONSE')
              }
              if (data.error !== undefined) {
                throw failureError(`ollama: ${String(data.error)}`, 'INVALID_REQUEST')
              }
              const message = data.message
              if (message !== null && typeof message === 'object') {
                const content = message.content
                if (typeof content === 'string' && content.length > 0) {
                  if (textBlock === undefined) {
                    textBlock = open('text')
                    yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
                  }
                  textBlock.text += content
                  yield { type: 'text-delta', index: textBlock.index, text: content }
                }
                const calls = message.tool_calls
                if (Array.isArray(calls)) {
                  for (const call of calls) {
                    if (call === null || typeof call !== 'object') continue
                    const fn = call.function !== null && typeof call.function === 'object' ? call.function : {}
                    const slot = call.index !== undefined && typeof call.index === 'number' ? call.index : 0
                    let block = toolBlocks.get(slot)
                    if (block === undefined) {
                      block = open('tool-call')
                      toolBlocks.set(slot, block)
                      yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
                    }
                    if (typeof call.id === 'string' && call.id.length > 0) block.callId = call.id
                    if (typeof fn.name === 'string' && fn.name.length > 0) block.name = fn.name
                    let fragment = ''
                    if (typeof fn.arguments === 'string') fragment = fn.arguments
                    else if (fn.arguments !== undefined) fragment = JSON.stringify(fn.arguments)
                    if (fragment.length > 0) {
                      block.text += fragment
                      yield {
                        type: 'tool-call-delta',
                        index: block.index,
                        id: block.callId ?? `call_${block.index}`,
                        ...block.name === undefined ? {} : { name: block.name },
                        argumentsDelta: fragment
                      }
                    }
                  }
                }
              }
              if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
                pendingUsage = {
                  inputTokens: typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : 0,
                  outputTokens: typeof data.eval_count === 'number' ? data.eval_count : 0
                }
              }
              if (data.done === true) {
                doneSeen = true
                pendingFinish = mapDoneReason(data.done_reason)
                for (const block of order) {
                  yield { type: 'block-end', index: block.index, block: closeBlock(block) }
                }
                if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage }
                const reason = pendingFinish ?? { kind: 'stop' }
                if (reason.kind === 'stop' && order.length === 0) {
                  throw failureError('ollama returned a completed response with no content', 'EMPTY_RESPONSE')
                }
                yield { type: 'finish', reason }
                return
              }
            }
          }
          if (!doneSeen) {
            const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
            throw failureError(`ollama: stream ended without a done frame${stderr.length > 0 ? ` (curl: ${stderr.trim().slice(0, 300)})` : ''}`, 'STREAM_CLOSED')
          }
        } finally {
          disarm()
          if (!doneSeen) {
            try {
              handle.terminate()
            } catch {
              /* already gone */
            }
          }
        }
      }
    }
  }
}
