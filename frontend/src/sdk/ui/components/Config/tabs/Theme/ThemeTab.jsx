import React, { useEffect, useState } from 'react';
import { TbMoon, TbSun, TbDeviceDesktop } from 'react-icons/tb';
import './ThemeTab.css';

const OPTIONS = [
  { id: 'dark', label: 'Oscuro', icon: <TbMoon /> },
  { id: 'light', label: 'Claro', icon: <TbSun /> },
  { id: 'system', label: 'Sistema', icon: <TbDeviceDesktop /> },
];

const ThemeTab = () => {
  const [theme, setTheme] = useState(() => localStorage.getItem('preferred-theme') || 'system');

  useEffect(() => {
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem('preferred-theme', theme);
  }, [theme]);

  return (
    <div className="th">
      <header className="th-head">
        <h3>Tema</h3>
        <p>Elige cómo se ve el sitio. El chat de Jarvis se mantiene en oscuro.</p>
      </header>
      <div className="th-options" role="radiogroup" aria-label="Tema">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={theme === o.id}
            className={`th-option ${theme === o.id ? 'active' : ''}`}
            onClick={() => setTheme(o.id)}
          >
            <span className="th-icon" aria-hidden="true">{o.icon}</span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeTab;
