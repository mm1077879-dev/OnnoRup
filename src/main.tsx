import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

window.history.scrollRestoration = 'manual';
window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

createRoot(document.getElementById('root')!).render(<App />);
