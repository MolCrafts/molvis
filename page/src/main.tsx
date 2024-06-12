import React from 'react'
import ReactDOM from 'react-dom/client'
import ViewPage from './view/page';
import './global.css';


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ViewPage />
  </React.StrictMode>,
)

export default ViewPage;