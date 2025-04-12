/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './static/**/*.{html,js}',
    '../backend/**/*.html' 
  ],
  theme: {
    extend: {
      // Keyframes moved to CSS file
      keyframes: {
        slideIn: {
          from: { opacity: '0', transform: 'translateY(-10px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        countUp: {
          from: { opacity: '0.5', transform: 'translateY(5px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' }
        }
      },
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
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          DEFAULT: '#3b82f6',
        },
        secondary: {
          DEFAULT: '#4F46E5',
          light: '#818CF8',
          dark: '#3730A3',
        },
        success: {
          DEFAULT: '#10B981',
          50: '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          800: '#065F46',
          900: '#064E3B',
        },
        warning: {
          DEFAULT: '#F59E0B',
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        danger: {
          DEFAULT: '#EF4444',
          50: '#FEF2F2',
          100: '#FEE2E2',
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#F87171',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
          800: '#991B1B',
          900: '#7F1D1D',
        },
        surface: {
          DEFAULT: '#ffffff',
          dark: '#111827',
          light: '#ffffff',
          hover: {
            light: '#f9fafb',
            dark: '#1f2937'
          }
        },
        border: {
          DEFAULT: '#e5e7eb',
          dark: '#374151',
          hover: {
            light: '#d1d5db',
            dark: '#4b5563'
          }
        },
        skeleton: {
          DEFAULT: '#f3f4f6',
          dark: '#4b5563',
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
      boxShadow: {
        '2xs': '0 1px 2px -1px rgb(0 0 0 / 0.1)',
        xs: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        sm: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
        card: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.1)',
      },
      borderWidth: {
        card: '1px',
      },
      borderRadius: {
        xs: '0.125rem',
        sm: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
        card: '0.5rem',
        'empty-state': '0.75rem',
      }
    },
  },
  plugins: [],
};
