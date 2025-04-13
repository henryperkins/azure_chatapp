module.exports = {
  content: [
    "./static/**/*.{html,js}",
    "./templates/**/*.html"
  ],
  theme: {
    extend: {
      colors: {
        primary: 'oklch(62.3% 0.214 259.815)',
        'primary-content': 'oklch(98.5% 0.002 247.839)',
        secondary: 'oklch(58.5% 0.233 277.117)',
        'secondary-content': 'oklch(98.5% 0.002 247.839)',
        accent: 'oklch(79.2% 0.209 151.711)',
        'accent-content': 'oklch(21% 0.034 264.665)',
        neutral: 'oklch(44.6% 0.03 256.802)',
        'neutral-content': 'oklch(98.5% 0.002 247.839)',
        'base-100': 'oklch(98.5% 0.002 247.839)',
        'base-200': 'oklch(96.7% 0.003 264.542)',
        'base-300': 'oklch(92.8% 0.006 264.531)',
        'base-content': 'oklch(21% 0.034 264.665)',
        info: 'oklch(70.7% 0.165 254.624)',
        'info-content': 'oklch(21% 0.034 264.665)',
        success: 'oklch(72.3% 0.219 149.579)',
        'success-content': 'oklch(21% 0.034 264.665)',
        warning: 'oklch(79.5% 0.184 86.047)',
        'warning-content': 'oklch(21% 0.034 264.665)',
        error: 'oklch(63.7% 0.237 25.331)',
        'error-content': 'oklch(98.5% 0.002 247.839)'
      },
      borderRadius: {
        selector: '0.375rem',
        field: '0.375rem',
        box: '0.5rem'
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('daisyui')
  ],
  daisyui: {
    themes: [{
      azurechat: {
        "primary": "oklch(62.3% 0.214 259.815)",
        "secondary": "oklch(58.5% 0.233 277.117)",
        "accent": "oklch(79.2% 0.209 151.711)",
        "neutral": "oklch(44.6% 0.03 256.802)",
        "base-100": "oklch(98.5% 0.002 247.839)",
        "info": "oklch(70.7% 0.165 254.624)",
        "success": "oklch(72.3% 0.219 149.579)",
        "warning": "oklch(79.5% 0.184 86.047)",
        "error": "oklch(63.7% 0.237 25.331)"
      }
    }]
  }
}
