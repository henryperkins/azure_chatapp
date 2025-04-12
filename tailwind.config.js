export default {
  // Auto content detection - no need for content array
  plugins: [
    require('@tailwindcss/typography'),
    require('daisyui')
  ],
  daisyui: {
    themes: [{
      light: {
        primary: "oklch(62.3% 0.214 259.815)",
        secondary: "oklch(58.5% 0.233 277.117)",
        /* Simplified color scheme definition */
      }
    }],
    logs: false
  }
}
