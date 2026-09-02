import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// tokens.css defines every custom property the primitives reference,
// base.css carries the reset, focus rings and prefers-reduced-motion rules,
// and identity-mark.css carries `.cmark` — an unscoped class five views
// render, which is why it is global rather than copied into each of their
// stylesheets (T-260901-30; it was in four of them). Nothing else imports
// these, so dropping a line kills part of the design system at runtime while
// every jsdom test stays green (T-260828-11 review, B1).
import './styles/tokens.css'
import './styles/base.css'
import './styles/identity-mark.css'
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
