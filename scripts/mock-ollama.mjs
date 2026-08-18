// Mock Ollama server for offline testing of the dsh-llm-ollama plugin.
// Implements GET /api/tags and POST /api/chat (NDJSON streaming, including a
// tool-call reply when the request carries tools). Records the last /api/chat
// request body to /tmp/ollama-mock-last.json so the num_ctx / num_predict /
// keep_alive wiring can be asserted.
//
// Usage: node scripts/mock-ollama.mjs   (listens on 127.0.0.1:11434)
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const PORT = 11434
const MODELS = [
  { name: 'llama3.2:3b', modified_at: '2024-01-01T00:00:00Z', size: 2019393181 },
  { name: 'qwen2.5:7b', modified_at: '2024-01-01T00:00:00Z', size: 4683593488 }
]

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ models: MODELS }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'bad json' }))
        return
      }
      try {
        writeFileSync('/tmp/ollama-mock-last.json', JSON.stringify(body, null, 2))
      } catch {}
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      const send = (obj) => res.write(`${JSON.stringify(obj)}\n`)
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        // Simulate a tool-call response streamed across frames.
        send({ model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: '' }, done: false })
        send({ model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_abc123', type: 'function', function: { name: body.tools[0].function.name, arguments: '{"city":"Bei' } }] }, done: false })
        send({ model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_abc123', type: 'function', function: { name: '', arguments: 'jing"}' } }] }, done: false })
        send({ model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: '' }, done: true, done_reason: 'tool_calls', prompt_eval_count: 31, eval_count: 11 })
        res.end()
        return
      }
      if (body.stream !== false) {
        const text = `Hello from mock ollama (model ${body.model}). ` + (body.options && body.options.num_ctx ? `num_ctx=${body.options.num_ctx} ` : '') + (body.options && body.options.num_predict ? `num_predict=${body.options.num_predict}` : '')
        const words = text.split(' ')
        let i = 0
        const timer = setInterval(() => {
          if (i < words.length) {
            send({ model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: `${words[i]} ` }, done: false })
            i++
          } else {
            clearInterval(timer)
            send({
              model: body.model,
              created_at: new Date().toISOString(),
              message: { role: 'assistant', content: '' },
              done: true,
              done_reason: 'stop',
              prompt_eval_count: 24,
              eval_count: words.length,
              ...(body.keep_alive !== undefined ? { keep_alive_received: body.keep_alive } : {})
            })
            res.end()
          }
        }, 5)
      } else {
        send({ model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: `non-stream reply for ${body.model}` }, done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 3 })
        res.end()
      }
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock ollama listening on ${PORT}`)
})
