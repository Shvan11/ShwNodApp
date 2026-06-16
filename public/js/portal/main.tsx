// Self-hosted Font Awesome (Vite asset pipeline) — replaces the render-blocking
// cdnjs <link> in portal.html. The portal bundle uses `fa fa-*` icons too.
import '@fortawesome/fontawesome-free/css/all.min.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import PortalApp from './PortalApp';

const container = document.getElementById('portal-root');
if (!container) {
  throw new Error('Missing #portal-root element');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <PortalApp />
  </React.StrictMode>
);
