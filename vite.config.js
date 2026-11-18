import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))
const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

function downloadPlugin() {
  const photoCache = new Map()
  function configure(server) {
    server.middlewares.use('/api/video-info', async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405).end(); return }
      const id = new URL(req.url, 'http://localhost').searchParams.get('id')
      if (!/^\d{1,24}$/.test(id || '')) { res.writeHead(400).end('Invalid video ID.'); return }
      try {
        const api = new URL('https://www.tikwm.com/api/')
        api.searchParams.set('url', id)
        const response = await fetch(api, { signal: AbortSignal.timeout(20000), redirect: 'error' })
        if (!response.ok) throw new Error('Video service failed')
        const result = await response.json()
        if (result.code !== 0 || !result.data || result.data.images?.length) throw new Error('Video not found')
        const data = result.data
        const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({
          title: typeof data.title === 'string' ? data.title.slice(0, 2000) : '',
          author: typeof data.author?.unique_id === 'string' ? data.author.unique_id.slice(0, 100) : '',
          views: count(data.play_count), comments: count(data.comment_count), shares: count(data.share_count),
          cover: `https://www.tikwm.com/video/cover/${id}.webp`,
        }))
      } catch { res.writeHead(502).end('Could not load video details. Please try again later.') }
    })
    server.middlewares.use('/api/photos', async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405).end(); return }
      const id = new URL(req.url, 'http://localhost').searchParams.get('id')
      if (!/^\d{1,24}$/.test(id || '')) { res.writeHead(400).end('Invalid photo post ID.'); return }
      try {
        const api = new URL('https://www.tikwm.com/api/')
        api.searchParams.set('url', id)
        const response = await fetch(api, { signal: AbortSignal.timeout(20000), redirect: 'error' })
        if (!response.ok) throw new Error('Photo service failed')
        const data = await response.json()
        if (data.code !== 0 || !Array.isArray(data.data?.images)) throw new Error('No photos found')
        const images = data.data.images.slice(0, 35).filter(item => {
          try {
            const url = new URL(item)
            return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
              ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com'].some(domain => url.hostname.endsWith(`.${domain}`))
          } catch { return false }
        })
        if (!images.length) throw new Error('No photos found')
        if (photoCache.size >= 100) photoCache.delete(photoCache.keys().next().value)
        photoCache.set(id, { images, expires: Date.now() + 10 * 60 * 1000 })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ count: images.length }))
      } catch {
        res.writeHead(502).end('Could not load photos for this post. Please try again later.')
      }
    })
    server.middlewares.use('/api/photo-file', async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405).end(); return }
      const params = new URL(req.url, 'http://localhost').searchParams
      const id = params.get('id')
      const indexText = params.get('index') || ''
      const entry = photoCache.get(id)
      if (!/^\d{1,24}$/.test(id || '') || !/^\d{1,2}$/.test(indexText) || !entry || entry.expires < Date.now() || !entry.images[Number(indexText)]) {
        res.writeHead(404).end('Photo expired. Load the post again.'); return
      }
      try {
        const response = await fetch(entry.images[Number(indexText)], { signal: AbortSignal.timeout(30000), redirect: 'error' })
        const type = response.headers.get('content-type')?.split(';')[0]
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type]
        if (!response.ok || !extension || Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw new Error('Invalid image')
        const data = Buffer.from(await response.arrayBuffer())
        if (data.length > 20 * 1024 * 1024) throw new Error('Image too large')
        const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
        if (params.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="tiktok-${id}-${Number(indexText) + 1}.${extension}"`
        res.writeHead(200, headers).end(data)
      } catch { if (!res.headersSent) res.writeHead(502).end('Could not download this photo. Please try again.') }
    })
    server.middlewares.use('/api/download', (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405).end(); return }
      let url
      try { url = new URL(new URL(req.url, 'http://localhost').searchParams.get('url')) } catch {
        res.writeHead(400).end('Enter a valid TikTok video link.'); return
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'].includes(url.hostname) ||
          !/^\/@[\w.-]+\/video\/\d+\/?$/.test(url.pathname)) {
        res.writeHead(400).end('Enter a full TikTok video link.'); return
      }
      const id = url.pathname.match(/\/(\d+)\/?$/)[1]
      const canonicalUrl = `https://www.tiktok.com${url.pathname}`
      const child = spawn(python, ['-m', 'yt_dlp', '--no-playlist', '--no-progress', '--no-warnings', '-f', 'best[ext=mp4]', '-o', '-', canonicalUrl], { windowsHide: true })
      let started = false
      let finished = false
      let stderr = ''
      const timeout = setTimeout(() => child.kill(), 120000)
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000) })
      child.stdout.on('data', chunk => {
        if (!started) {
          started = true
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="tiktok-${id}.mp4"`, 'Cache-Control': 'no-store' })
        }
        if (!res.write(chunk)) child.stdout.pause()
      })
      res.on('drain', () => child.stdout.resume())
      child.on('error', () => { if (!res.headersSent) res.writeHead(503).end('Downloader unavailable. Install the project dependencies.'); else res.destroy() })
      child.on('close', code => {
        clearTimeout(timeout)
        finished = true
        if (code !== 0) {
          console.error('Download failed:', stderr)
          if (!res.headersSent) res.writeHead(502).end('TikTok did not provide a downloadable video. Please try again later.')
          else res.destroy()
        } else if (!started) res.writeHead(502).end('TikTok did not provide a downloadable video.')
        else res.end()
      })
      res.on('close', () => { if (!finished) child.kill(); clearTimeout(timeout) })
    })
  }
  return { name: 'local-video-download', configureServer: configure, configurePreviewServer: configure }
}

export default defineConfig({ plugins: [vue(), downloadPlugin()] })
