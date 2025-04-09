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
    './static/css/*.css',
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
        'count-up': 'countUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.3s ease-in-out forwards',
        'fade-in-slow': 'fadeIn 0.5s ease-in-out forwards'
      },
      keyframes: {
        slideIn: {
          'from': { opacity: '0', transform: 'translateY(-10px)' },
          'to': { opacity: '1', transform: 'translateY(0)' }
        },
        countUp: {
          'from': { opacity: '0.5', transform: 'translateY(5px)' },
          'to': { opacity: '1', transform: 'translateY(0)' }
        },
        fadeIn: {
          'from': { opacity: '0' },
          'to': { opacity: '1' }
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
        'transform': 'transform',
        'slide': 'transform, opacity'
      },
      colors: {
        // Primary color palette
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          DEFAULT: '#3b82f6',
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
          dark: '#111827',
          light: '#ffffff',
          hover: {
            light: '#f9fafb',
            dark: '#1f2937'
          }
        },
        border: {
          DEFAULT: '#e5e7eb', // border-gray-200
          dark: '#374151', // dark:border-gray-700
          hover: {
            light: '#d1d5db', // border-gray-300
            dark: '#4b5563' // border-gray-600
          }
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
    require('tailwindcss/nesting'),
    // e.g., require('@tailwindcss/forms'), require('@tailwindcss/typography'), etc.
  ],
  variants: {
    extend: {
      animation: ['responsive', 'motion-safe', 'motion-reduce'],
      transitionProperty: ['responsive', 'hover', 'focus'],
    }
  },
};
