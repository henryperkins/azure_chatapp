// filepath: /home/azureuser/azure_chatapp/tailwind.config.js
export default {
  content: [
    "./static/html/*.html",
    "./static/js/*.js"
  ],
  plugins: [
    require('daisyui')
  ],
  // Enable container queries (Tailwind v4+)
  experimental: {
    containerQueries: true,
    // Add optional breakpoints if you want multiple container sizes:
    // respectDefaultKeyframes: true // Example if you need keyframe merges
  },
  daisyui: {
    themes: ["light", "dark"],
    logs: true
  }
}
