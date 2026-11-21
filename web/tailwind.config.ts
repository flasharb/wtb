import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#7c3aed',
          50: '#f3effe',
          100: '#e9e1fd',
          200: '#d4c4fb',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        gold: { DEFAULT: '#f6b50a', 400: '#fbcb3a', 600: '#d99706' },
        ink: {
          950: '#0a0620',
          900: '#0e0828',
          850: '#140b33',
          800: '#1a1040',
          700: '#241356',
          border: '#2c1b60',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-inter)', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(124, 58, 237, 0.5)',
        'glow-lg': '0 0 80px -10px rgba(124, 58, 237, 0.55)',
      },
      maxWidth: { content: '1120px' },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
      },
      animation: { float: 'float 6s ease-in-out infinite' },
    },
  },
  plugins: [],
};

export default config;
