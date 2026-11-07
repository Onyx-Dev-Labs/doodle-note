import './assets/main.css'
import './assets/redesign-type.css'
import './assets/windows-chrome.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './theme'
import { applyPlatformAttribute, hostPlatform } from './lib/platform'

// Before first paint — no light flash for dark-mode users, and Windows chrome
// (caption-button overlay, scrollbars) is styled from the first frame.
applyPlatformAttribute(document.documentElement, hostPlatform())
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
