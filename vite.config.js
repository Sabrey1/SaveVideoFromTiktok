import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import { Readable } from 'node:stream'
import { handleApi } from './server/api.js'

function localApi(env) {
  function configure(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next()
      try {
        const request = new Request(new URL(req.url, `http://${req.headers.host}`), {
          method: req.method,
          headers: req.headers,
          ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
        })
        const response = await handleApi(request, env)
        res.writeHead(response.status, Object.fromEntries(response.headers))
        if (!response.body) return res.end()
        const stream = Readable.fromWeb(response.body)
        stream.on('error', () => res.destroy())
        res.on('close', () => stream.destroy())
        stream.pipe(res)
      } catch { if (!res.headersSent) res.writeHead(500).end('The download service failed.'); else res.destroy() }
    })
  }
  return { name: 'local-api', configureServer: configure, configurePreviewServer: configure }
}

export default defineConfig(({ mode }) => ({ plugins: [vue(), localApi(loadEnv(mode, process.cwd(), 'IGRAMAPI_'))] }))
