import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // El cliente llama a /api/* y Vite lo redirige al servidor Express
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
