// filepath: /home/azureuser/azure_chatapp/tailwind.config.js
export default {
  content: [
    "./static/html/*.html",
    "./static/js/*.js"
  ],
  plugins: [
    require('daisyui')
  ],
  daisyui: {
    themes: ["light", "dark"],
    logs: true
  }
}
