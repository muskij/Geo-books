/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{htm,js}"],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Plus Jakarta Sans','system-ui','sans-serif'] },
      colors: {
        brand: {
          50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 
          400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 
          800: '#5b21b6', 900: '#4c1d95', 950: '#2e1065'
        },
        accent: '#10b981',
        surface: { light: '#ffffff', dark: '#0f172a' }
      },
      borderRadius: { '4xl': '2rem', '5xl': '3rem' },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0,0,0,0.07), 0 4px 6px -2px rgba(0,0,0,0.05)',
        'glow': '0 0 20px rgba(139, 92, 246, 0.15)',
        'premium': '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
        'inner-glow': 'inset 0 0 20px rgba(255, 255, 255, 0.05)'
      }
    }
  },
  plugins: [],
}
