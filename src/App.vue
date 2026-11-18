<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const link = ref('')
const loading = ref(false)
const message = ref('')
const photoPost = ref(null)
const videoPost = ref(null)
const downloading = ref(false)
const downloadingPhoto = ref(null)
const videoMessage = ref('')
const readyVideoUrl = ref('')
const photoMessage = ref('')
const readyPhotoUrls = ref({})

function clearResults() {
  photoPost.value = null
  videoPost.value = null
  message.value = ''
  videoMessage.value = ''
  readyVideoUrl.value = ''
  photoMessage.value = ''
  readyPhotoUrls.value = {}
}

function formatCount(value) {
  return new Intl.NumberFormat(locale.value === 'kh' ? 'km-KH' : 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

const apiErrors = {
  'The download service API key has not been configured.': 'errors.keyMissing',
  'The download service API key is invalid or not authorized.': 'errors.keyInvalid',
  'This request is not available on the configured API plan.': 'errors.plan',
  'This post is private or requires login.': 'errors.private',
  'The download service has reached its credit or request limit. Please try again later.': 'errors.limit',
  'This post or requested media is unavailable.': 'errors.unavailable',
  'The download service is temporarily unavailable.': 'errors.temporary',
  'No photos found for this post.': 'errors.photosMissing',
  'This is not a video post.': 'errors.notVideo',
  'The download service returned an invalid file link.': 'errors.invalidFile',
  'Could not retrieve this post. Please try again later.': 'errors.retrieve',
  'Could not resolve this TikTok share link. Please try again or use the full post link.': 'errors.resolve',
}

function localizedError(key) {
  return Object.assign(new Error(key), { i18nKey: key })
}

function notice(key, params = {}) { return { key, params } }
function errorNotice(error) { return notice(error.i18nKey || 'errors.network') }

async function readApiJson(response) {
  const type = response.headers.get('content-type') || ''
  if (type.includes('text/html')) {
    throw localizedError('errors.serviceMissing')
  }
  if (!response.ok) throw localizedError(apiErrors[await response.text()] || 'errors.generic')
  if (!type.includes('application/json')) throw localizedError('errors.unexpected')
  return response.json()
}

function postApi(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(readApiJson)
}

async function pasteLink() {
  try { link.value = await navigator.clipboard.readText(); clearResults() }
  catch { message.value = notice('errors.paste') }
}

async function download() {
  clearResults()
  let url
  try { url = new URL(link.value.trim()) } catch { message.value = notice('errors.completeLink'); return }
  const postHosts = ['www.tiktok.com', 'tiktok.com', 'm.tiktok.com']
  const shortLink = (['vt.tiktok.com', 'vm.tiktok.com'].includes(url.hostname) && /^\/[A-Za-z0-9]+\/?$/.test(url.pathname)) ||
    (postHosts.includes(url.hostname) && /^\/t\/[A-Za-z0-9]+\/?$/.test(url.pathname))
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      (!shortLink && (!postHosts.includes(url.hostname) || !/^\/@[\w.-]+\/(video|photo)\/\d{1,24}\/?$/.test(url.pathname)))) {
    message.value = notice('errors.invalidLink')
    return
  }
  if (shortLink) {
    loading.value = true
    try {
      const response = await fetch(`/api/resolve?url=${encodeURIComponent(url.href)}`)
      const result = await readApiJson(response)
      const resolved = new URL(result.url)
      if (resolved.protocol !== 'https:' || resolved.hostname !== 'www.tiktok.com' || resolved.username || resolved.password || resolved.port || !/^\/@[\w.-]+\/(video|photo)\/\d{1,24}\/?$/.test(resolved.pathname)) throw localizedError('errors.invalidResolved')
      url = resolved
    } catch (error) {
      message.value = errorNotice(error)
      loading.value = false
      return
    }
  }
  if (url.pathname.includes('/photo/')) {
    const id = url.pathname.match(/\/(\d+)\/?$/)[1]
    loading.value = true
    try {
      const result = await postApi('/api/photos', { id })
      photoPost.value = { id, count: result.count }
      message.value = notice(result.count === 1 ? 'photo.oneReady' : 'photo.countReady', { count: result.count })
    } catch (error) { message.value = errorNotice(error) }
    finally { loading.value = false }
    return
  }
  loading.value = true
  try {
    const id = url.pathname.match(/\/(\d+)\/?$/)[1]
    videoPost.value = { ...(await postApi('/api/video-info', { id })), id }
  } catch (error) { message.value = errorNotice(error) }
  finally { loading.value = false }
}

async function downloadVideo() {
  if (!videoPost.value) return
  const post = videoPost.value
  videoMessage.value = ''
  readyVideoUrl.value = ''
  downloading.value = true
  try {
    const result = await postApi('/api/download', { id: post.id })
    if (videoPost.value?.id === post.id) {
      readyVideoUrl.value = result.downloadUrl
      videoMessage.value = notice('video.ready')
    }
  } catch (error) { if (videoPost.value?.id === post.id) videoMessage.value = errorNotice(error) }
  finally { downloading.value = false }
}

async function downloadPhoto(index) {
  if (!photoPost.value || downloadingPhoto.value !== null) return
  const id = photoPost.value.id
  photoMessage.value = ''
  downloadingPhoto.value = index
  try {
    const result = await postApi('/api/photo-file', { id, index })
    if (photoPost.value?.id === id) {
      readyPhotoUrls.value = { ...readyPhotoUrls.value, [index]: result.downloadUrl }
      photoMessage.value = notice('photo.ready', { index: index + 1 })
    }
  } catch (error) { if (photoPost.value?.id === id) photoMessage.value = errorNotice(error) }
  finally { downloadingPhoto.value = null }
}
</script>

<template>
  <div class="app-shell">
    <header class="header">
      <a class="brand" href="#top"><span class="brand-icon" aria-hidden="true">↓</span> ClipSave</a>
      <div class="header-actions">
        <a class="header-link" href="#how">{{ t('navigation.how') }}</a>
        <select v-model="locale" class="language-select" :aria-label="t('language')">
          <option value="en">English</option>
          <option value="kh">ភាសាខ្មែរ</option>
        </select>
      </div>
    </header>

    <main id="top">
      <section class="hero">
        <div class="container">
          <h1>{{ t('hero.title') }}</h1>
          <p class="subtitle">{{ t('hero.subtitle') }}</p>

          <form class="download-card" @submit.prevent="download">
            <label for="video-link">{{ t('form.label') }}</label>
            <div class="input-row">
              <input id="video-link" v-model="link" placeholder="https://www.tiktok.com/@username/video/..." type="url" autocomplete="url" required @input="clearResults" />
              <button class="paste-button" type="button" @click="pasteLink">{{ t('form.paste') }}</button>
            </div>
            <button class="download-button" type="submit" :disabled="loading">
              {{ loading ? t('form.preparing') : t('form.continue') }}
            </button>
            <p v-if="message" class="message" role="status">{{ t(message.key, message.params) }}</p>
            <p class="form-help">{{ t('form.help') }}</p>
          </form>
          <section v-if="videoPost" class="video-result" :aria-label="t('video.details')">
            <div class="video-info">
              <img v-if="videoPost.cover" :src="videoPost.cover" :alt="t('video.cover')" class="video-cover" />
              <div class="video-details">
                <h2>{{ videoPost.title || t('video.fallbackTitle') }}</h2>
                <p v-if="videoPost.author" class="video-author">@{{ videoPost.author }}</p>
                <p class="video-stats"><span>{{ t('video.views', { count: formatCount(videoPost.views) }) }}</span><span>{{ t('video.comments', { count: formatCount(videoPost.comments) }) }}</span><span>{{ t('video.shares', { count: formatCount(videoPost.shares) }) }}</span></p>
              </div>
            </div>
            <button v-if="!readyVideoUrl" type="button" class="download-button" :disabled="downloading" @click="downloadVideo">{{ downloading ? t('video.preparing') : t('video.download') }}</button>
            <a v-else class="download-button save-link" :href="readyVideoUrl" rel="noreferrer" download>{{ t('video.save') }}</a>
            <p v-if="videoMessage" class="message" role="status">{{ t(videoMessage.key, videoMessage.params) }}</p>
          </section>
          <section v-if="photoPost" class="photo-results" :aria-label="t('photo.details')">
            <h2>{{ t('photo.title') }}</h2>
            <div class="photo-grid">
              <article v-for="index in photoPost.count" :key="index" class="photo-item">
                <span class="photo-label">{{ t('photo.label', { index }) }}</span>
                <button v-if="!readyPhotoUrls[index - 1]" type="button" class="photo-download" :disabled="downloadingPhoto !== null" @click="downloadPhoto(index - 1)">{{ downloadingPhoto === index - 1 ? t('photo.preparing') : t('photo.download') }}</button>
                <a v-else class="photo-download save-link" :href="readyPhotoUrls[index - 1]" rel="noreferrer" download>{{ t('photo.save') }}</a>
              </article>
            </div>
            <p v-if="photoMessage" class="message" role="status">{{ t(photoMessage.key, photoMessage.params) }}</p>
          </section>
        </div>
      </section>

      <section id="how" class="how container">
        <h2>{{ t('how.title') }}</h2>
        <div class="steps">
          <article><span class="step-number">1</span><h3>{{ t('how.copyTitle') }}</h3><p>{{ t('how.copyText') }}</p></article>
          <article><span class="step-number">2</span><h3>{{ t('how.pasteTitle') }}</h3><p>{{ t('how.pasteText') }}</p></article>
          <article><span class="step-number">3</span><h3>{{ t('how.continueTitle') }}</h3><p>{{ t('how.continueText') }}</p></article>
        </div>
      </section>
    </main>

    <footer><span>ClipSave</span><p></p></footer>
  </div>
</template>
