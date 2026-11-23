const MAX_PHOTOS = 35

function error(message, status = 502) {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store' } })
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.endsWith('.local')) return null
    return url.href
  } catch { return null }
}

async function resolveShortLink(value) {
  let current = new URL(value)
  for (let redirects = 0; redirects < 4; redirects++) {
    const validOrigin = current.protocol === 'https:' && !current.username && !current.password && !current.port
    const short = ['vt.tiktok.com', 'vm.tiktok.com'].includes(current.hostname) && /^\/[A-Za-z0-9]+\/?$/.test(current.pathname)
    const tiktokShort = ['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'].includes(current.hostname) && /^\/t\/[A-Za-z0-9]+\/?$/.test(current.pathname)
    const full = ['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'].includes(current.hostname) && /^\/@[\w.-]+\/(video|photo)\/\d{1,24}\/?$/.test(current.pathname)
    if (!validOrigin) throw new Error('Invalid link')
    if (full) return `https://www.tiktok.com${current.pathname}`
    if (!short && !tiktokShort) throw new Error('Invalid link')
    const response = await fetch(current, { method: 'HEAD', signal: AbortSignal.timeout(10000), redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) throw new Error('Link could not be resolved')
    current = new URL(location, current)
  }
  throw new Error('Too many redirects')
}

class ProviderError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

function tiktokPost(value, id) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'].includes(url.hostname) ||
        !/^\/@[\w.-]+\/(video|photo)\/\d{1,24}\/?$/.test(url.pathname) ||
        url.pathname.match(/\/(\d+)\/?$/)?.[1] !== id) return null
    return `https://www.tiktok.com${url.pathname}`
  } catch { return null }
}

function cobaltFileUrl(value, instanceUrl) {
  try {
    const url = new URL(value)
    const instance = new URL(instanceUrl)
    if (url.username || url.password) return null
    // A self-hosted Cobalt may return an HTTP tunnel on its configured LAN origin.
    if (url.origin === instance.origin && url.pathname === '/tunnel') return url.href
    return safeExternalUrl(value)
  } catch { return null }
}

async function cobaltRequest(env, postUrl) {
  const instance = new URL(env.COBALT_API_URL)
  if (!['http:', 'https:'].includes(instance.protocol) || instance.username || instance.password) throw new Error('Invalid Cobalt configuration')
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (env.COBALT_API_KEY) headers.Authorization = `Api-Key ${env.COBALT_API_KEY}`
  const response = await fetch(instance.href, {
    method: 'POST', headers, body: JSON.stringify({ url: postUrl }),
    redirect: 'manual', signal: AbortSignal.timeout(30000),
  })
  if (response.status === 429) throw new ProviderError('The download service has reached its credit or request limit. Please try again later.', 429)
  if (response.status === 401 || response.status === 403) throw new ProviderError('The download service API key is invalid or not authorized.', 503)
  let result
  try { result = await response.json() } catch { throw new ProviderError('The download service is temporarily unavailable.', 502) }
  if (result?.status === 'error' && result.error?.code === 'error.api.fetch.fail' && result.error?.context?.service === 'tiktok') {
    throw new ProviderError('Cobalt could not fetch this post from TikTok. Please try another post or try again later.', 502)
  }
  if (!response.ok) throw new ProviderError('The download service is temporarily unavailable.', 502)
  if (result?.status === 'error') throw new ProviderError('This post or requested media is unavailable.', 404)
  return result
}

async function handleCobalt(path, input, env) {
  const postUrl = tiktokPost(input.url, input.id)
  if (!postUrl) return error('Invalid post URL.', 400)
  if (path === '/api/photo-file' && (!Number.isInteger(input.index) || input.index < 0 || input.index >= MAX_PHOTOS)) return error('Invalid photo index.', 400)
  const result = await cobaltRequest(env, postUrl)
  if (path === '/api/photos' || path === '/api/photo-file') {
    const photos = result.status === 'picker' && Array.isArray(result.picker) ? result.picker.filter(item => item?.type === 'photo').slice(0, MAX_PHOTOS) : []
    if (!photos.length) throw new ProviderError('No photos found for this post.', 404)
    if (path === '/api/photos') return Response.json({ count: photos.length }, { headers: { 'Cache-Control': 'no-store' } })
    const downloadUrl = cobaltFileUrl(photos[input.index]?.url, env.COBALT_API_URL)
    if (!downloadUrl) throw new ProviderError('The download service returned an invalid file link.', 502)
    return Response.json({ downloadUrl }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (!['redirect', 'tunnel'].includes(result.status)) throw new ProviderError('This post or requested media is unavailable.', 404)
  const downloadUrl = cobaltFileUrl(result.url, env.COBALT_API_URL)
  if (!downloadUrl) throw new ProviderError('The download service returned an invalid file link.', 502)
  if (path === '/api/video-info') return Response.json({ title: '', author: '', views: null, comments: null, shares: null, cover: null, downloadUrl }, { headers: { 'Cache-Control': 'no-store' } })
  return Response.json({ downloadUrl }, { headers: { 'Cache-Control': 'no-store' } })
}

async function igramRequest(key, path, options = {}) {
  let response
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(`https://api.igramapi.com${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    })
    // Only retry explicit temporary service errors. Network errors are not retried
    // because a paid request might already have succeeded upstream.
    if (attempt === 0 && (response.status === 502 || response.status === 503)) {
      await response.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }
    break
  }
  if (!response.ok) {
    if (response.status === 401) throw new ProviderError('The download service API key is invalid or not authorized.', 503)
    if (response.status === 403) {
      let code
      try { code = (await response.json()).error?.code } catch { /* Use a generic message for non-JSON errors. */ }
      if (code === 'private_account' || code === 'login_required') throw new ProviderError('This post is private or requires login.', 403)
      throw new ProviderError('This request is not available on the configured API plan.', 403)
    }
    if (response.status === 402 || response.status === 429) throw new ProviderError('The download service has reached its credit or request limit. Please try again later.', 429)
    if (response.status === 400 || response.status === 404 || response.status === 422) throw new ProviderError('This post or requested media is unavailable.', 404)
    console.error('IGramAPI upstream error', { endpoint: path.split('?')[0], status: response.status })
    throw new ProviderError('The download service is temporarily unavailable.', 502)
  }
  return response.json()
}

export async function handleApi(request, env = {}) {
  const url = new URL(request.url)
  if (url.pathname === '/api/resolve') {
    if (request.method !== 'GET') return error('Method not allowed.', 405)
    try {
      return Response.json({ url: await resolveShortLink(url.searchParams.get('url')) }, { headers: { 'Cache-Control': 'no-store' } })
    } catch { return error('Could not resolve this TikTok share link. Please try again or use the full post link.', 400) }
  }
  if (!['/api/video-info', '/api/photos', '/api/download', '/api/photo-file'].includes(url.pathname)) return error('Not found.', 404)
  if (request.method !== 'POST') return error('Method not allowed.', 405)
  const origin = request.headers.get('origin')
  if (origin && origin !== url.origin) return error('Request origin not allowed.', 403)
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return error('Expected JSON.', 415)
  if (Number(request.headers.get('content-length')) > 2048) return error('Request is too large.', 413)
  let input
  try {
    if (!request.body) return error('Invalid request.', 400)
    const reader = request.body.getReader()
    let size = 0
    const chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2048) { await reader.cancel(); return error('Request is too large.', 413) }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { return error('Invalid request.', 400) }
  const id = input?.id
  if (typeof id !== 'string' || !/^\d{1,24}$/.test(id)) return error('Invalid post ID.', 400)
  if (env.COBALT_API_URL) {
    try { return await handleCobalt(url.pathname, input, env) }
    catch (cause) {
      if (cause instanceof ProviderError) return error(cause.message, cause.status)
      console.error('Cobalt request failed', { route: url.pathname, error: cause?.name || 'Unknown error' })
      return error('Could not retrieve this post. Please try again later.')
    }
  }
  if (!env.IGRAMAPI_KEY) return error('The download service API key has not been configured.', 503)
  const key = env.IGRAMAPI_KEY
  try {
    if (url.pathname === '/api/video-info' || url.pathname === '/api/photos') {
      const result = await igramRequest(key, `/v1/tiktok/videos?url=${encodeURIComponent(id)}`)
      if (url.pathname === '/api/photos') {
        if (result.type !== 'photo' || !Array.isArray(result.photos) || !result.photos.length) throw new ProviderError('No photos found for this post.', 404)
        return Response.json({ count: Math.min(result.photos.length, MAX_PHOTOS) }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (result.type !== 'video') throw new ProviderError('This is not a video post.', 400)
      const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0
      return Response.json({
        title: typeof result.description === 'string' ? result.description.slice(0, 2000) : '',
        author: typeof result.author?.username === 'string' ? result.author.username.slice(0, 100) : '',
        views: count(result.plays), comments: count(result.comments), shares: count(result.shares),
        cover: safeExternalUrl(result.cover),
      }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const isPhoto = url.pathname === '/api/photo-file'
    if (isPhoto && (!Number.isInteger(input.index) || input.index < 0 || input.index >= MAX_PHOTOS)) return error('Invalid photo index.', 400)
    const body = { type: isPhoto ? 'image' : 'video', url: id, filename: `tiktok-${id}${isPhoto ? `-${input.index + 1}` : ''}` }
    if (isPhoto) body.index = input.index
    else body.quality = 'best'
    const result = await igramRequest(key, '/v1/tiktok/downloads', { method: 'POST', body: JSON.stringify(body) })
    const downloadUrl = safeExternalUrl(result.download_url)
    if (!downloadUrl || typeof result.content_type !== 'string' || !result.content_type.startsWith(isPhoto ? 'image/' : 'video/')) throw new ProviderError('The download service returned an invalid file link.', 502)
    return Response.json({ downloadUrl }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (cause) {
    if (cause instanceof ProviderError) return error(cause.message, cause.status)
    console.error('IGramAPI request failed', { route: url.pathname, error: cause?.name || 'Unknown error' })
    return error('Could not retrieve this post. Please try again later.')
  }
}
