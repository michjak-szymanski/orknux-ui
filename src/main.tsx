import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';

import './styles/tokens.css';
import './styles/global.css';
import { App } from './App';
import { applyLanguage, currentLanguage } from './session/language';
import { applyTheme, currentTheme } from './session/theme';
import { t } from './i18n';

// Before the first paint, so a light interface never flashes dark on its way in.
applyTheme(currentTheme());
// And the same for the language, so `lang` is right for the first screen drawn
// rather than corrected once the session has been read.
applyLanguage(currentLanguage());

const container = document.getElementById('root');
if (!container) throw new Error(t('Root container #root not found'));

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
