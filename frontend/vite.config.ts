import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import packageJson from './package.json';

const packageVersion = process.env.VITE_APP_VERSION || packageJson.version || '0.0.0';
const buildTimestamp = process.env.VITE_BUILD_TIME || new Date().toISOString();
const commitRef =
  process.env.VITE_COMMIT_SHA ||
  process.env.GIT_COMMIT ||
  process.env.COMMIT_SHA ||
  '';
const shortCommitRef = commitRef ? commitRef.slice(0, 8) : '';
const fallbackBuildToken = buildTimestamp.replace(/[-:.TZ]/g, '');
const buildId = process.env.VITE_BUILD_ID || `${packageVersion}-${shortCommitRef || fallbackBuildToken}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __APP_BUILD_ID__: JSON.stringify(buildId),
    __APP_BUILD_TIME__: JSON.stringify(buildTimestamp),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
