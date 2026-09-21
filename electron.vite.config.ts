import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// `@shared` : les réglages et les types de conversation ont une seule
// définition, partagée par les trois process — sur VoiceType, leurs copies
// avaient fini par diverger.
const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: { ...alias, '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react()]
  }
})
