/** @type {import('tailwindcss').Config} */
module.exports = {
  corePlugins: {
    // Disable vendor prefixes since we're targeting modern browsers
    // This will remove -webkit, -moz, -ms prefixes from the output
    transform: false,
    transitionProperty: false,
    transitionDuration: false,
    transitionDelay: false,
    transitionTimingFunction: false,
    userSelect: false,
    appearance: false
  },
  content: [
    "./static/html/**/*.html",
    "./static/js/**/*.js"
  ],
  plugins: [
    require("@tailwindcss/typography"),
    require("daisyui")
  ],
  daisyui: {
    themes: [
      {
        dracula: {
          primary: "#ff55a8", // More saturated pink for high-contrast
          "primary-content": "#fff", // Explicitly force white text on primary
          secondary: "#8be9fd", // Brighter cyan for accent
          "secondary-content": "#191926", // Extra dark for contrast on secondary buttons
          accent: "#f1fa8c",
          neutral: "#44475a", // Slightly lighter neutral for border/active
          "neutral-content": "#fff", // White text on neutral backgrounds
          "base-100": "#1e1f28",
          "base-200": "#23243a", // More blue for section backgrounds
          "base-300": "#191926", // True dark as fallback
          "base-content": "#f8f8f2" // Can keep for base text
        }
      },
      "light", // enable DaisyUI's built-in light theme for fallback
      "dark",  // enable DaisyUI's built-in dark theme for fallback
      "cupcake", // (optional) more built-in themes for testing
    ],
    darkTheme: "dracula",
    base: true, // Enable DaisyUI base styles
    styled: true, // Enable DaisyUI component styles
    utils: true, // Enable responsive utility classes
    prefix: "", // No prefix for DaisyUI classes
    logs: true // Show build logs
  }
}
