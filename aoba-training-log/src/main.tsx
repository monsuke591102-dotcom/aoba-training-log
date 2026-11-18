import { createRoot } from 'react-dom/client'
import { App } from './App'
import './style.css'
import './stadium.css'

createRoot(document.getElementById('root')!).render(<App />)


if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'training-offline.js').catch(() => {
    // Local storage remains available if the browser blocks offline caching.
  })
}
