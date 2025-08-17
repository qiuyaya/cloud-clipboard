#!/usr/bin/env node

/**
 * Desktop Icon Sync Script for Cloud Clipboard
 * Syncs the main SVG icon to Tauri desktop application
 * Note: PNG/ICO formats need to be generated manually using design tools
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_ICONS_DIR = path.join(__dirname, '../assets/icons');
const TAURI_ICONS_DIR = path.join(__dirname, '../desktop/src-tauri/icons');

function syncDesktopIcons() {
  console.log('🖥️  Syncing desktop icons...');
  
  // Ensure directories exist
  if (!fs.existsSync(TAURI_ICONS_DIR)) {
    fs.mkdirSync(TAURI_ICONS_DIR, { recursive: true });
  }
  
  // Copy main SVG icon as reference
  const mainIconPath = path.join(ASSETS_ICONS_DIR, 'app-icon.svg');
  if (fs.existsSync(mainIconPath)) {
    fs.copyFileSync(mainIconPath, path.join(TAURI_ICONS_DIR, 'app-icon.svg'));
    console.log('✅ Copied app-icon.svg to Tauri icons directory');
  }
  
  // Create a readme for manual conversion
  const readmeContent = `# Desktop Icons

This directory contains icons for the Tauri desktop application.

## Files

- \`app-icon.svg\` - Source SVG icon (auto-synced from assets/icons)
- \`32x32.png\` - 32x32 PNG icon for Windows
- \`128x128.png\` - 128x128 PNG icon
- \`128x128@2x.png\` - High-DPI 128x128 PNG icon
- \`icon.ico\` - Windows ICO format
- \`icon.icns\` - macOS ICNS format

## Manual Generation Required

The PNG, ICO, and ICNS formats need to be generated manually from the SVG source.

### Recommended Tools:
- **Online**: https://cloudconvert.com/ or https://convertio.co/
- **Local**: Inkscape, ImageMagick, or design tools

### Commands (if tools available):
\`\`\`bash
# Using ImageMagick (if available)
convert app-icon.svg -resize 32x32 32x32.png
convert app-icon.svg -resize 128x128 128x128.png
convert app-icon.svg -resize 256x256 128x128@2x.png

# For ICO/ICNS, use specialized tools or online converters
\`\`\`

Last updated: ${new Date().toISOString()}
`;
  
  fs.writeFileSync(path.join(TAURI_ICONS_DIR, 'README.md'), readmeContent);
  console.log('✅ Generated README.md with conversion instructions');
  
  console.log('');
  console.log('⚠️  Note: PNG, ICO, and ICNS formats need manual generation');
  console.log('   from the SVG source using design tools or online converters.');
}

function main() {
  console.log('🔄 Desktop Icon Sync');
  console.log('====================');
  
  try {
    syncDesktopIcons();
    console.log('');
    console.log('🎉 Desktop icon sync completed!');
  } catch (error) {
    console.error('❌ Error syncing desktop icons:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { syncDesktopIcons };