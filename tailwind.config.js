import daisyui from 'daisyui';

// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
   content: [
      "./static/**/*.{html,js,jsx,ts,tsx,css}", // make sure your CSS entry is scanned
   ],
   theme: {
      extend: {
         keyframes: {
            fadeZoomIn: {
               '0%': { opacity: '0', transform: 'scale(0.95)' },
               '100%': { opacity: '1', transform: 'scale(1)' },
            },
         },
         animation: {
            fadeZoomIn: 'fadeZoomIn 0.3s ease-in-out forwards',
         },
      },
   },
   plugins: [
      daisyui,      // your existing DaisyUI v5 plugin
   ],
   daisyui: {
      themes: ['azure-light', 'dracula', 'dracula-enhanced'], // include your custom themes
   },
}
