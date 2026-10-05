import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { bootstrapPlatform } from './platform/bootstrap.ts'

// Инициализация платформы запускается в фоне и не блокирует первый рендер:
// игра обязана стартовать даже при недоступном SDK (п. 1.1, 1.19.1 требований).
bootstrapPlatform()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
