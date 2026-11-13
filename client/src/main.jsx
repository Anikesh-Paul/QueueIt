import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerQueueItServiceWorker } from './lib/register-sw.js'
import { captureInstallPrompt } from './lib/install-prompt.js'

captureInstallPrompt()
registerQueueItServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
