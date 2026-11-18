import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The site is served from /ColorCraft/ on GitHub Pages; set VITE_BASE=/ for a root domain.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/ColorCraft/',
  plugins: [react(), tailwindcss()],
});
