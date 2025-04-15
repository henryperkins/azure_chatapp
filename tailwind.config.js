// Tailwind CSS Configuration
// Adding daisyUI plugin for the base-200 and related classes.

module.exports = {
  content: [
    "./static/*.html",
    "./static/**/*.js"
  ],
  theme: {
    extend: {}
  },
  plugins: [
    require('daisyui')
  ],
  daisyui: {
    themes: ["light", "dark"], // You can adjust or add custom themes here
  }
};
