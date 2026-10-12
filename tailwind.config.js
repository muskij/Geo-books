/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{htm,js}"],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Plus Jakarta Sans','system-ui','sans-serif'] },
      colors: {
        brand: {
          50: '#f1f0ff', 100: '#e6e4ff', 200: '#cfcbff', 300: '#b0a8ff',
          400: '#8f84fa', 500: '#7468f5', 600: '#5b4cf0', 700: '#4a3bd9',
          800: '#3d30b0', 900: '#342b8a', 950: '#1f1a5c'
        },
        accent: '#10b981',
        surface: { light: '#ffffff', dark: '#0f172a' }
      },
      borderRadius: { '4xl': '2rem', '5xl': '3rem' },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0,0,0,0.07), 0 4px 6px -2px rgba(0,0,0,0.05)',
        'glow': '0 0 20px rgba(91, 76, 240, 0.18)',
        'premium': '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
        'inner-glow': 'inset 0 0 20px rgba(255, 255, 255, 0.05)'
      }
    }
  },
  plugins: [],
}
