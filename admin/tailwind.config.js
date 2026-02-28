/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          500: '#667eea',
          600: '#5568d3',
          700: '#4453b8',
        },
        secondary: {
          600: '#764ba2',
        },
      },
    },
  },
  plugins: [],
}
