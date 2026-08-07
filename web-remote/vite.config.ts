import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: '/second-shooter/',
  plugins: [react()],
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  envDir: path.resolve(__dirname, '..'),
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: true,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
