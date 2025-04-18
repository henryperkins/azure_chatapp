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
    containerQueries: true
  },
  daisyui: {
    themes: ["light", "dark"],
    logs: true
  }
}
