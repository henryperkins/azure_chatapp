module.exports = {
  content: ['./static/html/**/*.html', './static/js/**/*.js'],
  theme: {
    extend: {
      keyframes: {
        'mobile-fade-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'mobile-slide-in': {
          from: { transform: 'translateX(-100%)' },
          to:   { transform: 'translateX(0)' }
        },
        'mobile-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' }
        }
      },
      animation: {
        'mobile-fade-in': 'mobile-fade-in 0.3s ease-out forwards',
        'mobile-slide-in': 'mobile-slide-in 0.3s ease-out forwards',
        'mobile-pulse': 'mobile-pulse 2s infinite'
      }
    },
  },
  safelist: [
    'animate-mobile-fade-in',
    'animate-mobile-slide-in',
    'animate-mobile-pulse'
  ],
  plugins: [],
};
