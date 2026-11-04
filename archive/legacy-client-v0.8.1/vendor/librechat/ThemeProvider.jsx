// Adapted from LibreChat v0.8.1 packages/client/src/theme/context/ThemeProvider.tsx.
// MIT; original source, storage atom and full license are in third_party/librechat.
// Jotai storage is replaced with React state; dynamic color overrides are omitted
// so all screens use the unchanged upstream light/dark CSS token palette.
import { createContext, useContext, useEffect, useMemo, useCallback, useState } from 'react';

const modes = new Set(['light', 'dark', 'system']);
export const ThemeContext = createContext(null);
export const isDark = theme => theme === 'system'
  ? window.matchMedia('(prefers-color-scheme: dark)').matches
  : theme === 'dark';

export function ThemeProvider({ children, initialTheme }) {
  const [theme, updateTheme] = useState(() => {
    if (modes.has(initialTheme)) return initialTheme;
    try {
      const saved = localStorage.getItem('color-theme');
      // Jotai atomWithStorage serializes its string value as JSON.
      const parsed = saved?.startsWith('"') ? JSON.parse(saved) : saved;
      return modes.has(parsed) ? parsed : 'system';
    } catch { return 'system'; }
  });

  const setTheme = useCallback(value => {
    if (!modes.has(value)) return;
    updateTheme(value);
    try { localStorage.setItem('color-theme', JSON.stringify(value)); } catch { /* Browser storage may be disabled. */ }
  }, []);

  const applyThemeMode = useCallback(rawTheme => {
    const root = window.document.documentElement;
    const darkMode = isDark(rawTheme);
    root.classList.remove(darkMode ? 'light' : 'dark');
    root.classList.add(darkMode ? 'dark' : 'light');
    root.style.colorScheme = darkMode ? 'dark' : 'light';
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const changeThemeOnSystemChange = () => {
      if (theme === 'system') applyThemeMode('system');
    };
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', changeThemeOnSystemChange);
    else mediaQuery.addListener(changeThemeOnSystemChange);
    return () => {
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', changeThemeOnSystemChange);
      else mediaQuery.removeListener(changeThemeOnSystemChange);
    };
  }, [theme, applyThemeMode]);

  useEffect(() => { applyThemeMode(theme); }, [theme, applyThemeMode]);
  const resetTheme = useCallback(() => setTheme('system'), [setTheme]);
  const value = useMemo(() => ({ theme, setTheme, resetTheme }), [theme, setTheme, resetTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
export default ThemeProvider;
