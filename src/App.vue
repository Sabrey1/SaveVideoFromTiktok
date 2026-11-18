<script setup>
import { ref } from 'vue'

const link = ref('')
const loading = ref(false)
const message = ref('')
const photoPost = ref(null)
const videoPost = ref(null)
const downloading = ref(false)

function clearResults() {
  photoPost.value = null
  videoPost.value = null
  message.value = ''
}

function formatCount(value) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

async function readApiJson(response) {
  const type = response.headers.get('content-type') || ''
  if (type.includes('text/html')) {
    throw new Error('The download service is not configured on this host. Please contact the site administrator.')
  }
  if (!response.ok) throw new Error(await response.text())
  if (!type.includes('application/json')) throw new Error('The download service returned an unexpected response.')
  return response.json()
}

async function pasteLink() {
  try { link.value = await navigator.clipboard.readText(); clearResults() }
  catch { message.value = 'Paste the link into the field using your keyboard.' }
}

async function download() {
  clearResults()
  let url
  try { url = new URL(link.value.trim()) } catch { message.value = 'Enter a complete TikTok post link.'; return }
  const postHosts = ['www.tiktok.com', 'tiktok.com', 'm.tiktok.com']
  const shortLink = (['vt.tiktok.com', 'vm.tiktok.com'].includes(url.hostname) && /^\/[A-Za-z0-9]+\/?$/.test(url.pathname)) ||
    (postHosts.includes(url.hostname) && /^\/t\/[A-Za-z0-9]+\/?$/.test(url.pathname))
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      (!shortLink && (!postHosts.includes(url.hostname) || !/^\/@[\w.-]+\/(video|photo)\/\d{1,24}\/?$/.test(url.pathname)))) {
    message.value = 'Enter a valid TikTok video or photo link.'
    return
  }
  if (shortLink) {
    loading.value = true
    try {
      const response = await fetch(`/api/resolve?url=${encodeURIComponent(url.href)}`)
      const result = await readApiJson(response)
      const resolved = new URL(result.url)
      if (resolved.protocol !== 'https:' || resolved.hostname !== 'www.tiktok.com' || resolved.username || resolved.password || resolved.port || !/^\/@[\w.-]+\/(video|photo)\/\d{1,24}\/?$/.test(resolved.pathname)) throw new Error('TikTok returned an invalid post link.')
      url = resolved
    } catch (error) {
      message.value = error.message || 'Could not resolve the TikTok link. Please try again.'
      loading.value = false
      return
    }
  }
  if (url.pathname.includes('/photo/')) {
    const id = url.pathname.match(/\/(\d+)\/?$/)[1]
    loading.value = true
    try {
      const response = await fetch(`/api/photos?id=${encodeURIComponent(id)}`)
      const result = await readApiJson(response)
      photoPost.value = { id, count: result.count }
      message.value = `${result.count} ${result.count === 1 ? 'photo is' : 'photos are'} ready to download.`
    } catch (error) { message.value = error.message || 'Could not load photos. Please try again.' }
    finally { loading.value = false }
    return
  }
  loading.value = true
  try {
    const id = url.pathname.match(/\/(\d+)\/?$/)[1]
    const response = await fetch(`/api/video-info?id=${encodeURIComponent(id)}`)
    videoPost.value = { ...(await readApiJson(response)), url: url.href, id }
  } catch (error) { message.value = error.message || 'Could not load video details. Please try again.' }
  finally { loading.value = false }
}

async function downloadVideo() {
  if (!videoPost.value) return
  const post = videoPost.value
  message.value = ''
  downloading.value = true
  try {
    const response = await fetch(`/api/download?url=${encodeURIComponent(post.url)}`)
    if ((response.headers.get('content-type') || '').includes('text/html')) throw new Error('The download service is not configured on this host. Please contact the site administrator.')
    if (!response.ok) throw new Error(await response.text())
    if (!(response.headers.get('content-type') || '').startsWith('video/')) throw new Error('The download service did not return a video.')
    const blob = await response.blob()
    if (!blob.size) throw new Error('The downloaded video was empty. Please try again.')
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `tiktok-${post.id}.mp4`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
    message.value = 'Your download has started.'
  } catch (error) { message.value = error.message || 'Download failed. Please try again.' }
  finally { downloading.value = false }
}
</script>

<template>
  <div class="app-shell">
    <header class="header">
      <a class="brand" href="#top"><span class="brand-icon" aria-hidden="true">↓</span> ClipSave</a>
      <a class="header-link" href="#how">How to use</a>
    </header>

    <main id="top">
      <section class="hero">
        <div class="container">
          <h1>TikTok Downloader</h1>
          <p class="subtitle">Paste a TikTok link to download a video or photos.</p>

          <form class="download-card" @submit.prevent="download">
            <label for="video-link">TikTok video or photo link</label>
            <div class="input-row">
              <input id="video-link" v-model="link" placeholder="https://www.tiktok.com/@username/video/..." type="url" autocomplete="url" required @input="clearResults" />
              <button class="paste-button" type="button" @click="pasteLink">Paste</button>
            </div>
            <button class="download-button" type="submit" :disabled="loading">
              {{ loading ? 'Preparing your download...' : 'Continue' }}
            </button>
            <p v-if="message" class="message" role="status">{{ message }}</p>
            <p class="form-help">Use a public TikTok video or photo link, including mobile share links.</p>
          </form>
          <section v-if="videoPost" class="video-result" aria-label="Video details">
            <div class="video-info">
              <img :src="videoPost.cover" alt="Video cover" class="video-cover" />
              <div class="video-details">
                <h2>{{ videoPost.title || 'TikTok video' }}</h2>
                <p v-if="videoPost.author" class="video-author">@{{ videoPost.author }}</p>
                <p class="video-stats"><span>{{ formatCount(videoPost.views) }} views</span><span>{{ formatCount(videoPost.comments) }} comments</span><span>{{ formatCount(videoPost.shares) }} shares</span></p>
              </div>
            </div>
            <button type="button" class="download-button" :disabled="downloading" @click="downloadVideo">{{ downloading ? 'Downloading...' : 'Download' }}</button>
          </section>
          <section v-if="photoPost" class="photo-results" aria-label="Photos available for download">
            <h2>Photos</h2>
            <div class="photo-grid">
              <article v-for="index in photoPost.count" :key="index" class="photo-item">
                <img :src="`/api/photo-file?id=${photoPost.id}&index=${index - 1}`" :alt="`Photo ${index}`" loading="lazy" />
                <a :href="`/api/photo-file?id=${photoPost.id}&index=${index - 1}&download=1`">Download photo {{ index }}</a>
              </article>
            </div>
          </section>
        </div>
      </section>

      <section id="how" class="how container">
        <h2>How to download a video</h2>
        <div class="steps">
          <article><span class="step-number">1</span><h3>Copy the link</h3><p>Open the video on TikTok, select Share, and copy its link.</p></article>
          <article><span class="step-number">2</span><h3>Paste it here</h3><p>Paste the full video or photo link into the field above.</p></article>
          <article><span class="step-number">3</span><h3>Continue</h3><p>Download a video or choose photos to save.</p></article>
        </div>
      </section>
    </main>

    <footer><span>ClipSave</span><p></p></footer>
  </div>
</template>
