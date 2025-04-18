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
    respectDefaultKeyframes: true
  },
  theme: {
    extend: {
      fontFamily: {
        'poppins': 'var(--font-poppins)',
      },
      boxShadow: {
        'custom': 'var(--shadow-custom)',
      },
      colors: {
        'blue': {
          500: 'var(--color-blue-500, #1d4ed8)',
        },
        'white': 'var(--color-white, #ffffff)',
      },
    },
  },
  daisyui: {
    themes: ["light", "dark"],
    logs: true
  }
}
