const MAX_PHOTOS = 35
const CDN_DOMAINS = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokv.com']

class UpstreamRateLimitError extends Error {}

function error(message, status = 502) {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store' } })
}

function mediaUrl(value) {
  try {
    const url = new URL(value, 'https://www.tikwm.com')
    const trusted = url.hostname === 'www.tikwm.com' || CDN_DOMAINS.some(domain => url.hostname.endsWith(`.${domain}`))
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && trusted ? url : null
  } catch { return null }
}

async function getPost(id, requestOrigin) {
  // Reuse successful metadata briefly, especially for multi-photo posts.
  const cache = globalThis.caches?.default
  const cacheKey = new Request(new URL(`/__clipsave_media_cache/${id}`, requestOrigin))
  if (cache) {
    try {
      const cached = await cache.match(cacheKey)
      if (cached) return await cached.json()
    } catch { /* The upstream still works if the cache is unavailable. */ }
  }
  const url = new URL('https://www.tikwm.com/api/')
  url.searchParams.set('url', id)
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'manual' })
      if (!response.ok) throw new Error(`Media service returned HTTP ${response.status}`)
      const result = await response.json()
      if (result.code !== 0 && /limit/i.test(String(result.msg || ''))) throw new UpstreamRateLimitError('Media service rate limit reached')
      if (result.code !== 0 || !result.data) throw new Error(`Post unavailable (service code: ${String(result.code).slice(0, 20)}; message: ${String(result.msg || '').slice(0, 120)})`)
      if (cache) {
        try { await cache.put(cacheKey, Response.json(result.data, { headers: { 'Cache-Control': 'public, max-age=60' } })) } catch { /* Caching is optional. */ }
      }
      return result.data
    } catch (cause) {
      if (cause instanceof UpstreamRateLimitError) throw cause
      lastError = cause
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

export async function handleApi(request) {
  if (request.method !== 'GET') return error('Method not allowed.', 405)
  const url = new URL(request.url)
  let id = url.searchParams.get('id')
  if (url.pathname === '/api/download') {
    try {
      const post = new URL(url.searchParams.get('url'))
      const match = post.pathname.match(/^\/@[\w.-]+\/video\/(\d{1,24})\/?$/)
      if (post.protocol !== 'https:' || post.username || post.password || post.port || !['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'].includes(post.hostname) || !match) throw new Error('Invalid URL')
      id = match[1]
    } catch { return error('Enter a full TikTok video link.', 400) }
  }
  if (!/^\d{1,24}$/.test(id || '')) return error('Invalid post ID.', 400)
  if (!['/api/video-info', '/api/photos', '/api/photo-file', '/api/download'].includes(url.pathname)) return error('Not found.', 404)

  try {
    const post = await getPost(id, url.origin)
    if (url.pathname === '/api/video-info') {
      if (post.images?.length) return error('This is a photo post.', 400)
      const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0
      return Response.json({
        title: typeof post.title === 'string' ? post.title.slice(0, 2000) : '',
        author: typeof post.author?.unique_id === 'string' ? post.author.unique_id.slice(0, 100) : '',
        views: count(post.play_count), comments: count(post.comment_count), shares: count(post.share_count),
        cover: `https://www.tikwm.com/video/cover/${id}.webp`,
      }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (url.pathname === '/api/photos' || url.pathname === '/api/photo-file') {
      const images = Array.isArray(post.images) ? post.images.slice(0, MAX_PHOTOS).map(mediaUrl).filter(Boolean) : []
      if (!images.length) return error('No photos found for this post.')
      if (url.pathname === '/api/photos') return Response.json({ count: images.length }, { headers: { 'Cache-Control': 'no-store' } })
      const index = url.searchParams.get('index') || ''
      if (!/^\d{1,2}$/.test(index) || !images[Number(index)]) return error('Photo not found.', 404)
      const media = await fetch(images[Number(index)], { signal: AbortSignal.timeout(30000), redirect: 'manual' })
      const type = media.headers.get('content-type')?.split(';')[0]
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type]
      if (!media.ok || !media.body || !ext) throw new Error('Image unavailable')
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="tiktok-${id}-${Number(index) + 1}.${ext}"`
      return new Response(media.body, { headers })
    }
    const source = mediaUrl(post.play)
    if (!source || post.images?.length) throw new Error('Video unavailable')
    const media = await fetch(source, { signal: AbortSignal.timeout(60000), redirect: 'manual' })
    if (!media.ok || !media.body || !media.headers.get('content-type')?.startsWith('video/')) throw new Error('Video unavailable')
    return new Response(media.body, { headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="tiktok-${id}.mp4"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (cause) {
    console.error('Media request failed', { route: url.pathname, error: cause instanceof Error ? cause.message : 'Unknown error' })
    if (cause instanceof UpstreamRateLimitError) return error('The photo and video service has reached its daily limit. Please try again later.', 429)
    return error('Could not retrieve this post. Please try again later.')
  }
}
