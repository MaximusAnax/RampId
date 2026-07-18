import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Non-critical OpenAI proxy for CreateAgent personality blurbs / tooltips.
 * Never used by swarm, zoom, SynapseFlow, or what-if paths.
 */
function agentReasoningProxy(): Plugin {
  return {
    name: 'agent-reasoning-proxy',
    configureServer(server) {
      server.middlewares.use('/api/agent-reasoning', async (req, res, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
            kind?: string
            name?: string
            role?: string
            objective?: string
            prompt?: string
          }

          const fallback = () => {
            if (body.kind === 'personality') {
              return `${body.name ?? 'Agent'} operates as ${body.role ?? 'a specialist'} with a mandate to ${body.objective || 'support organizational objectives'}. Trust is earned continuously.`
            }
            return 'Offline simulation response — governance logic is local.'
          }

          const apiKey = process.env.OPENAI_API_KEY
          if (!apiKey) {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ text: fallback(), source: 'local' }))
            return
          }

          const prompt =
            body.prompt ??
            `Write one short personality blurb (max 40 words) for an AI financial agent named ${body.name}, role ${body.role}, objective: ${body.objective}. No marketing fluff.`

          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 4000)

          try {
            const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0.6,
                max_tokens: 120,
                messages: [
                  {
                    role: 'system',
                    content:
                      'You write terse ops-center copy for AI workforce agents. One sentence only.',
                  },
                  { role: 'user', content: prompt },
                ],
              }),
              signal: controller.signal,
            })
            clearTimeout(timeout)

            if (!apiRes.ok) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ text: fallback(), source: 'local' }))
              return
            }

            const data = (await apiRes.json()) as {
              choices?: { message?: { content?: string } }[]
            }
            const text =
              data.choices?.[0]?.message?.content?.trim() || fallback()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ text, source: 'openai' }))
          } catch {
            clearTimeout(timeout)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ text: fallback(), source: 'local' }))
          }
        } catch {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), agentReasoningProxy()],
})
