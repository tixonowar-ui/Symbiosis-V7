import { createRoot } from 'react-dom/client';

import { App } from './app.js';

const mount = document.getElementById('root');
if (mount === null) throw new Error('web entry mount #root not found');

createRoot(mount).render(<App />);
