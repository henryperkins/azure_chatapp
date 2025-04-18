/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./static/html/**/*.html",
    "./static/js/**/*.js"
  ],
  plugins: [
    require("@tailwindcss/typography"),
    require("daisyui")
  ],
  daisyui: {
    themes: [{
      dracula: {
        primary: "#ff79c6",
        secondary: "#bd93f9",
        accent: "#f1fa8c",
        neutral: "#6272a4",
        "base-100": "#1e1f28",
        "base-200": "#1a1b23",
        "base-300": "#16171e",
        "base-content": "#f8f8f2"
      }
    }],
    darkTheme: "dracula",
    base: false // Disable DaisyUI base to avoid Preflight conflicts
  }
}
