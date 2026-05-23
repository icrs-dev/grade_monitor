import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  return (
    <button
      onClick={() => setIsDark(!isDark)}
      className="p-2 rounded-full border border-neutral-200 dark:border-neutral-800 bg-apple-bg-light dark:bg-apple-bg-darkSec text-apple-text-lightPrimary dark:text-apple-text-darkPrimary hover:bg-neutral-50 dark:hover:bg-neutral-900 apple-transition flex items-center justify-center focus:outline-none"
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Sun size={16} className="text-neutral-400 hover:text-amber-500 apple-transition" />
      ) : (
        <Moon size={16} className="text-neutral-500 hover:text-indigo-600 apple-transition" />
      )}
    </button>
  );
}
