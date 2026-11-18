import { createClient } from '@supabase/supabase-js'

export const config = __TRAINING_CLOUD_CONFIG__
export const supabase = config ? createClient(config.url, config.key, {
  auth: {
    storageKey: config.storageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
}) : null



