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
    './static/projects.html',
    './static/js/*.js',
    './static/css/**/*.css',
    // If you have additional subdirectories or template files:
    '../backend/**/*.html',
    // Adjust or add paths to match your project structure:
  ],

  theme: {
    extend: {
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'slide-in': 'slideIn 0.2s ease-out forwards',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'count-up': 'countUp 0.3s ease-out'
      },
      keyframes: {
        slideIn: {
          'from': { opacity: '0', transform: 'translateY(-10px)' },
          'to': { opacity: '1', transform: 'translateY(0)' }
        },
        countUp: {
          'from': { opacity: '0.5', transform: 'translateY(5px)' },
          'to': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      // Add proper z-index values
      zIndex: {
        '60': '60',
        '70': '70',
        '80': '80',
        '90': '90',
        '100': '100',
        '999': '999',
        'modal': '1000',
        'dropdown': '1010',
        'tooltip': '1020',
        'notification': '1030'
      },
      transitionProperty: {
        'transform': 'transform'
      },
      colors: {
        // Primary color palette
        primary: {
          DEFAULT: '#1E40AF',
          light: '#60A5FA',
          dark: '#1E3A8A',
        },
        // Secondary color palette
        secondary: {
          DEFAULT: '#4F46E5',
          light: '#818CF8',
          dark: '#3730A3',
        },
        // State colors
        success: colors.green,
        warning: colors.amber,
        danger: colors.rose,
        // Dark mode surface colors
        surface: {
          DEFAULT: colors.white,
          dark: '#111827', // Changed to match existing dark bg-gray-900
        },
        border: {
          DEFAULT: '#e5e7eb', // Existing border-gray-200
          dark: '#374151', // Existing dark:border-gray-700
        },
        skeleton: {
          DEFAULT: '#f3f4f6', // bg-gray-100
          dark: '#4b5563', // dark:bg-gray-700
        }
      },
      spacing: {
        'card-padding': '1rem',
        'card-spacing': '1rem',
        'touch-min': '44px',
      },
      screens: {
        'xs': '320px',
        '3xl': '1920px',
        '4xl': '2560px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      },
      borderWidth: {
        card: '1px',
      },
      borderRadius: {
        card: '0.5rem',
        'empty-state': '0.75rem',
      }
    },
  },

  // Load any official or custom plugins here.
  plugins: [
    // e.g., require('@tailwindcss/forms'), require('@tailwindcss/typography'), etc.
  ],
  variants: {
    extend: {
      animation: ['responsive', 'motion-safe', 'motion-reduce'],
      transitionProperty: ['responsive', 'hover', 'focus'],
    }
  },
};
