/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Paleta industrial oscura
        surface:  '#0f172a',  // fondo principal
        card:     '#1e293b',  // tarjetas
        border:   '#334155',  // bordes sutiles
        muted:    '#64748b',  // texto secundario
        // Semáforo de estados
        ok:       '#22c55e',
        warn:     '#f59e0b',
        danger:   '#ef4444',
        info:     '#38bdf8',
      },
      animation: {
        'pulse-red': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
