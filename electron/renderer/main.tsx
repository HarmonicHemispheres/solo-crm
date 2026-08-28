import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// tokens.css defines every custom property the primitives reference and
// base.css carries the reset, focus rings and prefers-reduced-motion rules —
// nothing else imports them, so dropping these lines kills the design system
// at runtime while every jsdom test stays green (T-260828-11 review, B1).
import './styles/tokens.css'
import './styles/base.css'
import App from './App'

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root element not found')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
