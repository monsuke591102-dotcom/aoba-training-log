import { createRoot } from 'react-dom/client'
import { App } from './App'
import './style.css'
import './stadium.css'

const root = createRoot(document.getElementById('root')!)
if (__MATCH_TEST_BUILD__ && (!window.isSecureContext || location.origin !== __MATCH_TEST_BUILD__.origin)) {
  root.render(<main className="shell content"><h1>AOBA LOG 検証用</h1><p>このビルドは指定された検証用HTTPSオリジンでのみ起動できます。</p></main>)
} else {
  root.render(<App />)
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'training-offline.js').catch(() => {
      // Local storage remains available if the browser blocks offline caching.
    })
  }
}
