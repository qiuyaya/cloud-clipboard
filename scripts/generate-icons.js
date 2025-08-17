#!/usr/bin/env node

/**
 * Icon generation script for Cloud Clipboard
 * Generates all required icon formats from the main SVG source
 */

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '../assets/icons');
const CLIENT_PUBLIC_DIR = path.join(__dirname, '../client/public');
// const TAURI_ICONS_DIR = path.join(__dirname, '../desktop/src-tauri/icons');

// Main SVG content for the app icon
const mainIconSVG = `<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background circle with gradient -->
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="cloudGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.95" />
      <stop offset="100%" style="stop-color:#f1f5f9;stop-opacity:0.95" />
    </linearGradient>
    <linearGradient id="clipboardGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#e2e8f0;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background -->
  <circle cx="128" cy="128" r="120" fill="url(#bgGradient)" />
  
  <!-- Cloud shape -->
  <path d="M80 110c-12 0-22 10-22 22 0 8 4 15 11 19h74c7-4 11-11 11-19 0-12-10-22-22-22-2-15-15-26-30-26s-28 11-30 26h8z" fill="url(#cloudGradient)" stroke="#e2e8f0" stroke-width="2"/>
  
  <!-- Clipboard body -->
  <rect x="90" y="140" width="76" height="90" rx="8" fill="url(#clipboardGradient)" stroke="#cbd5e1" stroke-width="2"/>
  
  <!-- Clipboard clip -->
  <rect x="115" y="130" width="26" height="20" rx="3" fill="#64748b" />
  <rect x="118" y="133" width="20" height="14" rx="2" fill="#f8fafc" />
  
  <!-- Document lines -->
  <rect x="102" y="160" width="52" height="3" rx="1.5" fill="#94a3b8" />
  <rect x="102" y="170" width="42" height="3" rx="1.5" fill="#94a3b8" />
  <rect x="102" y="180" width="48" height="3" rx="1.5" fill="#94a3b8" />
  <rect x="102" y="190" width="38" height="3" rx="1.5" fill="#94a3b8" />
  
  <!-- Sync/connection indicators (small dots) -->
  <circle cx="75" cy="95" r="3" fill="#10b981" />
  <circle cx="181" cy="95" r="3" fill="#10b981" />
  <circle cx="85" cy="85" r="2" fill="#34d399" />
  <circle cx="171" cy="85" r="2" fill="#34d399" />
</svg>`;

// Web favicon sizes needed
const webSizes = [16, 32, 48, 180, 192, 512];

function generateWebIcons() {
  console.log('📱 Generating web icons...');
  
  // Main app icon
  fs.writeFileSync(path.join(CLIENT_PUBLIC_DIR, 'icon.svg'), mainIconSVG);
  
  // Favicon (optimized for small size)
  const faviconSVG = mainIconSVG.replace('width="256" height="256"', 'width="32" height="32"');
  fs.writeFileSync(path.join(CLIENT_PUBLIC_DIR, 'favicon.svg'), faviconSVG);
  
  // Different sized favicons
  webSizes.forEach(size => {
    const scaledSVG = mainIconSVG.replace('width="256" height="256"', `width="${size}" height="${size}"`);
    fs.writeFileSync(path.join(CLIENT_PUBLIC_DIR, `favicon-${size}x${size}.svg`), scaledSVG);
  });
  
  console.log(`✅ Generated web icons: icon.svg, favicon.svg, and ${webSizes.length} sized favicons`);
}

function copyToAssets() {
  console.log('📂 Copying icons to assets directory...');
  
  // Ensure assets directory exists
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }
  
  // Copy main icons
  fs.writeFileSync(path.join(ASSETS_DIR, 'app-icon.svg'), mainIconSVG);
  fs.writeFileSync(path.join(ASSETS_DIR, 'favicon.svg'), mainIconSVG.replace('width="256" height="256"', 'width="32" height="32"'));
  
  console.log('✅ Icons copied to assets directory');
}

function generateManifest() {
  console.log('📄 Generating web manifest...');
  
  const manifest = {
    name: "Cloud Clipboard",
    short_name: "CloudClip",
    description: "Share clipboard content seamlessly across devices",
    icons: webSizes.map(size => ({
      src: `/favicon-${size}x${size}.svg`,
      sizes: `${size}x${size}`,
      type: "image/svg+xml",
      ...(size === 180 ? { purpose: "apple-touch-icon" } : {}),
      ...(size >= 192 ? { purpose: "any maskable" } : {})
    })),
    theme_color: "#6366f1",
    background_color: "#ffffff",
    display: "standalone",
    start_url: "/",
    scope: "/"
  };
  
  fs.writeFileSync(
    path.join(CLIENT_PUBLIC_DIR, 'site.webmanifest'),
    JSON.stringify(manifest, null, 2)
  );
  
  console.log('✅ Web manifest generated');
}

function main() {
  console.log('🎨 Cloud Clipboard Icon Generator');
  console.log('==================================');
  
  try {
    // Ensure directories exist
    if (!fs.existsSync(CLIENT_PUBLIC_DIR)) {
      fs.mkdirSync(CLIENT_PUBLIC_DIR, { recursive: true });
    }
    
    generateWebIcons();
    copyToAssets();
    generateManifest();
    
    console.log('');
    console.log('🎉 All icons generated successfully!');
    console.log('');
    console.log('📍 Generated files:');
    console.log(`   • ${CLIENT_PUBLIC_DIR}/icon.svg`);
    console.log(`   • ${CLIENT_PUBLIC_DIR}/favicon.svg`);
    console.log(`   • ${CLIENT_PUBLIC_DIR}/favicon-*x*.svg (${webSizes.length} sizes)`);
    console.log(`   • ${CLIENT_PUBLIC_DIR}/site.webmanifest`);
    console.log(`   • ${ASSETS_DIR}/app-icon.svg`);
    console.log(`   • ${ASSETS_DIR}/favicon.svg`);
    console.log('');
    console.log('💡 Note: Desktop icons in Tauri format need to be generated manually');
    console.log('   using design tools or online converters from the SVG source.');
    
  } catch (error) {
    console.error('❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateWebIcons, copyToAssets, generateManifest };