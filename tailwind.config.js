/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts,scss}'],
  theme: {
    extend: {
      // All colors map to CSS variables — themes work by swapping variable values
      // on the <html> element, zero component changes needed per theme.
      colors: {
        bg:             'var(--color-bg)',
        surface:        'var(--color-surface)',
        'surface-2':    'var(--color-surface-2)',
        'surface-3':    'var(--color-surface-3)',
        border:         'var(--color-border)',
        'border-subtle':'var(--color-border-subtle)',

        primary:        'var(--color-text)',
        muted:          'var(--color-text-muted)',
        faint:          'var(--color-text-faint)',

        accent:         'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-light': 'var(--color-accent-light)',
        'accent-muted': 'var(--color-accent-muted)',

        danger:         'var(--color-danger)',
        'danger-muted': 'var(--color-danger-muted)',
        success:        'var(--color-success)',
        'success-muted':'var(--color-success-muted)',
        warning:        'var(--color-warning)',
        'warning-muted':'var(--color-warning-muted)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel:   'var(--shadow-panel)',
        modal:   'var(--shadow-modal)',
        tooltip: 'var(--shadow-tooltip)',
        'accent-glow': '0 0 20px var(--color-accent-glow)',
      },
      // Animation names reference keyframes defined in globals.css
      animation: {
        'fade-in':     'fadeIn       250ms cubic-bezier(0,0,0.2,1) both',
        'fade-out':    'fadeOut      200ms cubic-bezier(0.4,0,1,1) both',
        'slide-up':    'slideUpIn    250ms cubic-bezier(0,0,0.2,1) both',
        'slide-down':  'slideDownIn  250ms cubic-bezier(0,0,0.2,1) both',
        'slide-left':  'slideLeftIn  250ms cubic-bezier(0,0,0.2,1) both',
        'slide-right': 'slideRightIn 250ms cubic-bezier(0,0,0.2,1) both',
        'scale-in':    'scaleIn      250ms cubic-bezier(0,0,0.2,1) both',
        'modal-in':    'modalIn      300ms cubic-bezier(0,0,0.2,1) both',
        'modal-out':   'modalOut     200ms cubic-bezier(0.4,0,1,1) both',
        'sidebar-in':  'sidebarIn    300ms cubic-bezier(0,0,0.2,1) both',
        'message-in':  'messageIn    250ms cubic-bezier(0,0,0.2,1) both',
        'pulse-glow':  'pulseGlow    2s   cubic-bezier(0.4,0,0.2,1) infinite',
        'icon-bounce': 'iconBounce   250ms cubic-bezier(0.34,1.56,0.64,1) both',
        'shake':       'shake        250ms cubic-bezier(0.4,0,0.2,1) both',
      },
    },
  },
  plugins: [],
};