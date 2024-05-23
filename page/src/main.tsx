import React from 'react'
import ReactDOM from 'react-dom/client'
import MolvisCore from './Core';
import './index.css';


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MolvisCore canvas={document.getElementById('molvis-display') as HTMLCanvasElement}></MolvisCore>
  </React.StrictMode>,
)

export default MolvisCore;