import React from 'react'
import { createRoot } from 'react-dom/client'
import { DashboardApp } from './components/Dashboard/DashboardApp'
import './styles/dashboard.css'
import './styles/sprite.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>
)
