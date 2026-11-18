export function cloudConfig(rawUrl: unknown, rawKey: unknown) {
  if (typeof rawUrl !== 'string' || typeof rawKey !== 'string') return null
  const key = rawKey.trim()
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return null
  try {
    const url = new URL(rawUrl.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return { url: url.origin, key, storageKey: 'aoba-training-log-auth-' + url.host }
  } catch {
    return null
  }
}
