export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './static/js/**/*.js',
    './static/**/*.html',
    './templates/**/*.html'
  ],
  plugins: [
    require('daisyui'),
    require('@tailwindcss/typography')
  ],
  daisyui: {
    themes: [{ 
      light: {
        "color-scheme": "light",
        "primary": "oklch(62.3% 0.214 259.815)",
        "secondary": "oklch(58.5% 0.233 277.117)"
      }
    }],
    darkTheme: "dark",
    logs: false
  }
};
