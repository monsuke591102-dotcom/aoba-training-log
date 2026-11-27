import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { cloudConfig } from './src/cloudConfig'
import { offlineShell } from './offlineShell'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  let matchTest: { origin: string; build: string } | null = null
  let matchTestHost: string | undefined
  if (mode === 'match-test') {
    const origin = URL.parse(env.VITE_MATCH_TEST_ORIGIN || '')
    if (!origin || origin.protocol !== 'https:' || origin.origin !== env.VITE_MATCH_TEST_ORIGIN ||
      origin.hostname === 'github.io' || origin.hostname.endsWith('.github.io')) {
      throw new Error('VITE_MATCH_TEST_ORIGIN must be a dedicated HTTPS origin outside GitHub Pages.')
    }
    const build = env.VITE_MATCH_TEST_BUILD || ''
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(build)) throw new Error('Set VITE_MATCH_TEST_BUILD to a short build identifier.')
    matchTest = { origin: origin.origin, build }
    matchTestHost = origin.hostname
  }
  const cloud = matchTest ? null : cloudConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
  return {
    plugins: [react(), offlineShell(Boolean(matchTest))],
    base: matchTest ? '/' : env.VITE_BASE_PATH || '/',
    preview: matchTestHost ? { allowedHosts: [matchTestHost] } : undefined,
    build: { target: ['chrome107', 'edge107', 'firefox104', 'safari16'], cssTarget: 'safari16' },
    envPrefix: [],
    define: {
      __TRAINING_CLOUD_CONFIG__: JSON.stringify(cloud),
      __LOCAL_MENU_DELETE__: JSON.stringify(!matchTest && !cloud && env.VITE_ENABLE_LOCAL_MENU_DELETE === 'true'),
      __LOCAL_MATCH_RECORDS__: JSON.stringify(!matchTest && !cloud && env.VITE_ENABLE_LOCAL_MATCH_RECORDS === 'true'),
      __PAGES_MATCH_RECORDS__: JSON.stringify(Boolean(cloud)),
      __STRIKEOUT_CLASSIFICATION__: JSON.stringify(env.VITE_STRIKEOUT_CLASSIFICATION !== 'compatibility'),
      __MATCH_TEST_BUILD__: JSON.stringify(matchTest),
    },
  }
})

