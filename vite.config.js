import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { Readable } from 'node:stream'
import { handleApi } from './server/api.js'

function localApi() {
  function configure(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next()
      try {
        const response = await handleApi(new Request(new URL(req.url, 'http://localhost'), { method: req.method }))
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

export default defineConfig({ plugins: [vue(), localApi()] })
