const KEY = 'orknux.theme';

export type Theme = 'dark' | 'light';

/**
 * Which way round the interface is drawn.
 *
 * Kept in the browser rather than on the server: it is a property of where
 * somebody is sitting, not of who they are, and reading it from local storage
 * means it can be applied before the first paint. Anything that ever has to
 * follow a person between machines — a profile, a key — belongs on the server
 * instead, and this is not that.
 */
export function currentTheme(): Theme {
  try {
    return window.localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    // A browser that refuses storage still works; it is simply always dark.
    return 'dark';
  }
}

/**
 * Puts the theme on the root element, where `tokens.css` picks it up.
 *
 * Dark writes no attribute at all: it is what the tokens already are, and an
 * attribute that means "leave everything as it is" is one more thing to keep
 * in step.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    root.removeAttribute('data-theme');
  }
}

export function rememberTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered is not broken: the choice holds until the tab is closed.
  }
}
