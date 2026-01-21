import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  root: 'docs',
  build: {
    outDir: '../dist',
  },
  server: {
    https: true,
    host: true,  // Erlaubt Zugriff von anderen Geräten
    port: 5173,
  }
});