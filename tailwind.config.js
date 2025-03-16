const colors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Enable dark mode using the 'class' strategy:
  // By toggling the 'dark' class on <html> or <body>, 
  // you can control dark mode in your application.
  darkMode: 'class',

  // The 'content' array tells Tailwind which files to scan for class names.
  content: [
    './static/index.html',
    './static/js/**/*.js',
    './static/css/**/*.css',
    // If you have additional subdirectories or template files:
    '../backend/**/*.html',
    // Adjust or add paths to match your project structure:
  ],

  theme: {
    // Extend or override the default Tailwind theme here.
    extend: {
      // Example: custom breakpoints, or additional brand colors, etc.
      screens: {
        // Already in Tailwind by default, but you can add new ones:
        'xs': '320px',
        '2xl': '1536px',
        '3xl': '1920px', // Potential custom breakpoint
        '4xl': '2560px',
      },
      // Example: brand-specific colors
      colors: {
          brandBlue: '#1E40AF',
          brandLightBlue: '#60A5FA',
          purple: colors.purple
      },
      // Example: custom spacing or font families
      spacing: {
        '128': '32rem',
        'touch-min': '44px',
      },
    },
  },

  // Load any official or custom plugins here.
  plugins: [
    // e.g., require('@tailwindcss/forms'), require('@tailwindcss/typography'), etc.
  ],
};
