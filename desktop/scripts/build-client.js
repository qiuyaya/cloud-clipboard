#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLIENT_DIR = path.join(PROJECT_ROOT, 'client');
const DESKTOP_DIR = path.join(PROJECT_ROOT, 'desktop');
const CLIENT_DIST = path.join(CLIENT_DIR, 'dist');
const DESKTOP_SRC = path.join(DESKTOP_DIR, 'src');

console.log('🔧 Building client for desktop app...');

// 1. Build shared package
console.log('📦 Building shared package...');
process.chdir(path.join(PROJECT_ROOT, 'shared'));
execSync('bun run build', { stdio: 'inherit' });

// 2. Copy desktop integration files to client
console.log('📋 Copying desktop integration files...');
const filesToCopy = [
  'desktop-api.ts',
  'clipboard-monitor.ts', 
  'desktop-integration.tsx',
  'DesktopApp.tsx',
  'components/DesktopSettings.tsx'
];

filesToCopy.forEach(file => {
  const srcPath = path.join(DESKTOP_SRC, file);
  const destPath = path.join(CLIENT_DIR, 'src/desktop', file);
  
  // Ensure destination directory exists
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`  ✓ Copied ${file}`);
  } else {
    console.warn(`  ⚠️  Warning: ${file} not found`);
  }
});

// 3. Create desktop-specific main entry
console.log('📝 Creating desktop entry point...');
const desktopMainContent = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { DesktopApp } from './desktop/DesktopApp';
import App from './App';
import './index.css';
import './i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopApp WebApp={App} />
  </React.StrictMode>,
);
`;

fs.writeFileSync(
  path.join(CLIENT_DIR, 'src/main-desktop.tsx'),
  desktopMainContent.trim()
);

// 4. Update vite config for desktop build
console.log('⚙️  Updating Vite config for desktop...');
const viteConfigDesktop = `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/main-desktop.tsx')
      }
    }
  },
  define: {
    'process.env': {}
  }
});
`;

fs.writeFileSync(
  path.join(CLIENT_DIR, 'vite.config.desktop.ts'), 
  viteConfigDesktop.trim()
);

// 5. Build client with desktop config
console.log('🏗️  Building client with desktop integration...');
process.chdir(CLIENT_DIR);
execSync('npx vite build --config vite.config.desktop.ts', { stdio: 'inherit' });

console.log('✅ Desktop client build completed!');
console.log(`📂 Output: ${CLIENT_DIST}`);