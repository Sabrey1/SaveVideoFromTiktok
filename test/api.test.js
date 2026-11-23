import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { handleApi } from '../server/api.js'

const env = { IGRAMAPI_KEY: 'test-key' }
const request = (path, body) => new Request(`https://clipsave.example${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://clipsave.example' }, body: JSON.stringify(body),
})

test('video details are mapped and the API key stays server-side', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /^https:\/\/api\.igramapi\.com\/v1\/tiktok\/videos\?url=123$/)
    assert.equal(options.headers.Authorization, 'Bearer test-key')
    return Response.json({ type: 'video', description: 'A video', author: { username: 'creator' }, plays: 20, comments: 3, shares: 2, cover: 'https://cdn.example.com/cover.jpg' })
  })
  try {
    const response = await handleApi(request('/api/video-info', { id: '123' }), env)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { title: 'A video', author: 'creator', views: 20, comments: 3, shares: 2, cover: 'https://cdn.example.com/cover.jpg' })
    assert.equal(fetchMock.mock.calls.length, 1)
  } finally { fetchMock.mock.restore() }
})

test('photo list costs one metadata request and a photo download requests only the selected index', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('/videos?')) return Response.json({ type: 'photo', photos: [{}, {}, {}] })
    assert.equal(options.method, 'POST')
    assert.deepEqual(JSON.parse(options.body), { type: 'image', url: '123', filename: 'tiktok-123-2', index: 1 })
    return Response.json({ download_url: 'https://files.example.com/photo.jpg', content_type: 'image/jpeg' })
  })
  try {
    const list = await handleApi(request('/api/photos', { id: '123' }), env)
    assert.deepEqual(await list.json(), { count: 3 })
    assert.equal(fetchMock.mock.calls.length, 1)
    const photo = await handleApi(request('/api/photo-file', { id: '123', index: 1 }), env)
    assert.deepEqual(await photo.json(), { downloadUrl: 'https://files.example.com/photo.jpg' })
    assert.equal(fetchMock.mock.calls.length, 2)
  } finally { fetchMock.mock.restore() }
})

test('video downloads use one explicit paid request', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://api.igramapi.com/v1/tiktok/downloads')
    assert.deepEqual(JSON.parse(options.body), { type: 'video', url: '123', filename: 'tiktok-123', quality: 'best' })
    return Response.json({ download_url: 'https://files.example.com/video.mp4', content_type: 'video/mp4' })
  })
  try {
    const response = await handleApi(request('/api/download', { id: '123' }), env)
    assert.deepEqual(await response.json(), { downloadUrl: 'https://files.example.com/video.mp4' })
    assert.equal(fetchMock.mock.calls.length, 1)
  } finally { fetchMock.mock.restore() }
})

test('paid operations reject missing keys, cross-origin requests and invalid photo indexes', async () => {
  assert.equal((await handleApi(request('/api/download', { id: '123' }))).status, 503)
  const crossOrigin = new Request('https://clipsave.example/api/download', { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: '{"id":"123"}' })
  assert.equal((await handleApi(crossOrigin, env)).status, 403)
  assert.equal((await handleApi(request('/api/photo-file', { id: '123', index: 35 }), env)).status, 400)
})

test('provider rate limits are surfaced without retrying paid requests', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429 }))
  try {
    const response = await handleApi(request('/api/download', { id: '123' }), env)
    assert.equal(response.status, 429)
    assert.match(await response.text(), /limit/i)
    assert.equal(fetchMock.mock.calls.length, 1)
  } finally { fetchMock.mock.restore() }
})

test('temporary upstream errors are retried once', async () => {
  let calls = 0
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    calls++
    return calls === 1
      ? new Response('{}', { status: 502 })
      : Response.json({ download_url: 'https://files.example.com/video.mp4', content_type: 'video/mp4' })
  })
  try {
    const response = await handleApi(request('/api/download', { id: '123' }), env)
    assert.equal(response.status, 200)
    assert.equal(calls, 2)
  } finally { fetchMock.mock.restore() }
})

test('transport errors are not retried for paid downloads', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('network error') })
  try {
    const response = await handleApi(request('/api/download', { id: '123' }), env)
    assert.equal(response.status, 502)
    assert.equal(fetchMock.mock.calls.length, 1)
  } finally { fetchMock.mock.restore() }
})

test('mobile redirects may only reach TikTok post URLs', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 301, headers: { location: 'https://www.tiktok.com/@creator/photo/123?share=1' } }))
  try {
    const response = await handleApi(new Request('https://clipsave.example/api/resolve?url=https%3A%2F%2Fvt.tiktok.com%2FABC%2F'))
    assert.deepEqual(await response.json(), { url: 'https://www.tiktok.com/@creator/photo/123' })
  } finally { fetchMock.mock.restore() }
})

test('Cobalt accepts a validated post URL and returns a local tunnel link', async () => {
  const cobaltEnv = { COBALT_API_URL: 'http://192.168.56.102:9000/', COBALT_API_KEY: 'secret' }
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), cobaltEnv.COBALT_API_URL)
    assert.equal(options.headers.Authorization, 'Api-Key secret')
    assert.deepEqual(JSON.parse(options.body), { url: 'https://www.tiktok.com/@creator/video/123' })
    return Response.json({ status: 'tunnel', url: 'http://192.168.56.102:9000/tunnel?token=abc' })
  })
  try {
    const body = { id: '123', url: 'https://www.tiktok.com/@creator/video/123?tracking=1' }
    const info = await handleApi(request('/api/video-info', body), cobaltEnv)
    const details = await info.json()
    assert.equal(details.views, null)
    assert.equal(details.downloadUrl, 'http://192.168.56.102:9000/tunnel?token=abc')
    const result = await handleApi(request('/api/download', body), cobaltEnv)
    assert.deepEqual(await result.json(), { downloadUrl: 'http://192.168.56.102:9000/tunnel?token=abc' })
    assert.equal((await handleApi(request('/api/download', { ...body, url: 'https://evil.example/@creator/video/123' }), cobaltEnv)).status, 400)
    assert.equal(fetchMock.mock.calls.length, 2)
  } finally { fetchMock.mock.restore() }
})

test('Cobalt photo picker is filtered and invalid links are rejected', async () => {
  const cobaltEnv = { COBALT_API_URL: 'https://cobalt.example/' }
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ status: 'picker', picker: [
    { type: 'video', url: 'https://files.example.com/video.mp4' },
    { type: 'photo', url: 'https://files.example.com/photo.jpg' },
    { type: 'photo', url: 'http://127.0.0.1/private' },
  ] }))
  try {
    const body = { id: '123', url: 'https://www.tiktok.com/@creator/photo/123' }
    assert.deepEqual(await (await handleApi(request('/api/photos', body), cobaltEnv)).json(), { count: 2 })
    assert.deepEqual(await (await handleApi(request('/api/photo-file', { ...body, index: 0 }), cobaltEnv)).json(), { downloadUrl: 'https://files.example.com/photo.jpg' })
    assert.equal((await handleApi(request('/api/photo-file', { ...body, index: 1 }), cobaltEnv)).status, 502)
  } finally { fetchMock.mock.restore() }
})

test('Cobalt TikTok fetch failures are surfaced even on an HTTP error', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ status: 'error', error: { code: 'error.api.fetch.fail', context: { service: 'tiktok' } } }, { status: 500 }))
  try {
    const response = await handleApi(request('/api/video-info', { id: '123', url: 'https://www.tiktok.com/@creator/video/123' }), { COBALT_API_URL: 'https://cobalt.example/' })
    assert.equal(response.status, 502)
    assert.match(await response.text(), /Cobalt could not fetch this post from TikTok/)
  } finally { fetchMock.mock.restore() }
})
