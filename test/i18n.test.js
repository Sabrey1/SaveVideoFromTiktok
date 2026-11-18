import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createI18n } from 'vue-i18n'

const en = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'))
const kh = JSON.parse(readFileSync(new URL('../src/locales/kh.json', import.meta.url), 'utf8'))

function keys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof item === 'string' ? [path] : keys(item, path)
  }).sort()
}

test('English and Khmer have matching translation keys', () => {
  assert.deepEqual(keys(kh), keys(en))
})

test('language changes update translated messages and keep interpolation', () => {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, kh } })
  assert.equal(i18n.global.t('photo.label', { index: 2 }), 'Photo 2')
  i18n.global.locale.value = 'kh'
  assert.equal(i18n.global.t('photo.label', { index: 2 }), 'រូបភាពទី 2')
  assert.notEqual(i18n.global.t('form.continue'), en.form.continue)
})

test('every message is valid in both languages', () => {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, kh } })
  for (const language of ['en', 'kh']) {
    i18n.global.locale.value = language
    for (const key of keys(en)) assert.ok(i18n.global.t(key, { count: 2, index: 2 }))
  }
})
