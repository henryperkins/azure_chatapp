// Tailwind CSS Configuration
// Adding daisyUI plugin for the base-200 and related classes.

module.exports = {
  content: [
    "./static/**/*.html",
    "./static/**/*.js"
  ],
  theme: {
    extend: {
      borderRadius: {
        'xs': '0.125rem',  // Previously was 'sm'
        'sm': '0.25rem',   // Previously was DEFAULT
        'md': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        'full': '9999px'
      }
    }
  },
  plugins: [
    require('daisyui')
  ],
  daisyui: {
    themes: ["light", "dark"]
  }
};
