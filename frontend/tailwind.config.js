/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        apple: {
          bg: {
            light: '#ffffff',
            lightSec: '#f5f5f7',
            dark: '#000000',
            darkSec: '#1d1d1f',
          },
          text: {
            lightPrimary: '#1d1d1f',
            lightSecondary: '#86868b',
            darkPrimary: '#f5f5f7',
            darkSecondary: '#86868b',
          },
          blue: {
            light: '#0066cc',
            dark: '#2997ff',
          }
        }
      },
      fontFamily: {
        sans: [
          'SF Pro Text',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif',
        ],
        display: [
          'SF Pro Display',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif',
        ],
      },
      transitionTimingFunction: {
        'apple-ease': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
    },
  },
  plugins: [],
}
