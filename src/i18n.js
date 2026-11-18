import { createI18n } from 'vue-i18n'
import { watch } from 'vue'
import en from './locales/en.json'
import kh from './locales/kh.json'

let initialLocale = 'en'
try {
  const saved = localStorage.getItem('clipsave-language')
  if (saved === 'en' || saved === 'kh') initialLocale = saved
} catch { /* Language selection still works when storage is unavailable. */ }

const i18n = createI18n({ legacy: false, locale: initialLocale, fallbackLocale: 'en', messages: { en, kh } })

watch(i18n.global.locale, value => {
  document.documentElement.lang = value === 'kh' ? 'km' : 'en'
  document.title = `ClipSave — ${i18n.global.t('hero.title')}`
  try { localStorage.setItem('clipsave-language', value) } catch { /* Ignore blocked storage. */ }
}, { immediate: true })

export default i18n
