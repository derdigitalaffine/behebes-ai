import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import packageJson from './package.json';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const localNodeModulesDir = path.resolve(rootDir, 'node_modules');
const workspaceNodeModulesDir = path.resolve(rootDir, '..', 'node_modules');
const reactAliasPath = fs.existsSync(path.join(localNodeModulesDir, 'react'))
  ? path.join(localNodeModulesDir, 'react')
  : path.join(workspaceNodeModulesDir, 'react');
const reactDomAliasPath = fs.existsSync(path.join(localNodeModulesDir, 'react-dom'))
  ? path.join(localNodeModulesDir, 'react-dom')
  : path.join(workspaceNodeModulesDir, 'react-dom');

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

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: {
    __ADMIN_APP_VERSION__: JSON.stringify(packageVersion),
    __ADMIN_APP_BUILD_ID__: JSON.stringify(buildId),
    __ADMIN_APP_BUILD_TIME__: JSON.stringify(buildTimestamp),
  },
  base: command === 'build' ? '/admin/' : '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: reactAliasPath,
      'react-dom': reactDomAliasPath,
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
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
}));
