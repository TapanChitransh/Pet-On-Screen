import React from 'react'
import { createRoot } from 'react-dom/client'
import { PetApp } from './components/Pet/PetApp'
import './styles/pet.css'
import './styles/sprite.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PetApp />
  </React.StrictMode>
)
