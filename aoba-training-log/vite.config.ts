import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { cloudConfig } from './src/cloudConfig'
import { offlineShell } from './offlineShell'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const cloud = cloudConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
  return {
    plugins: [react(), offlineShell()],
    base: env.VITE_BASE_PATH || '/',
    build: { target: ['chrome107', 'edge107', 'firefox104', 'safari16'], cssTarget: 'safari16' },
    envPrefix: [],
    define: {
      __TRAINING_CLOUD_CONFIG__: JSON.stringify(cloud),
      __LOCAL_MENU_DELETE__: JSON.stringify(!cloud && env.VITE_ENABLE_LOCAL_MENU_DELETE === 'true'),
    },
  }
})

