// No icon font here: the portal draws its few icons as inline SVG (PortalIcon).
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
