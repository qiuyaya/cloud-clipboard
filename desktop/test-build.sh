#!/bin/bash

echo "🧪 Testing desktop app setup..."

# Check Rust installation
echo "📋 Checking Rust installation..."
if command -v cargo &> /dev/null; then
    echo "  ✅ Rust/Cargo: $(cargo --version)"
else
    echo "  ❌ Rust not found"
    exit 1
fi

# Check if Tauri CLI is available
echo "📋 Checking Tauri CLI..."
if command -v tauri &> /dev/null; then
    echo "  ✅ Tauri CLI: $(tauri --version)"
else
    echo "  ⚠️  Tauri CLI not found globally, will use local npm install"
fi

# Check Node.js
echo "📋 Checking Node.js..."
if command -v node &> /dev/null; then
    echo "  ✅ Node.js: $(node --version)"
else
    echo "  ❌ Node.js not found"
    exit 1
fi

# Test Rust build
echo "📋 Testing Rust compilation..."
cd src-tauri
if cargo check; then
    echo "  ✅ Rust code compiles successfully"
else
    echo "  ❌ Rust compilation failed"
    exit 1
fi

cd ..

echo "🎉 Desktop app setup test completed successfully!"
echo ""
echo "🚀 Next steps:"
echo "  1. Install desktop dependencies: npm install"
echo "  2. Build client for desktop: npm run build-client"
echo "  3. Start development: npm run dev"
echo "  4. Build for production: npm run build"
echo ""
echo "📱 Platform support:"
echo "  - Windows: tauri build --target x86_64-pc-windows-msvc"
echo "  - macOS Intel: tauri build --target x86_64-apple-darwin"
echo "  - macOS Apple Silicon: tauri build --target aarch64-apple-darwin"
echo "  - Linux: tauri build --target x86_64-unknown-linux-gnu"
echo "  - Android: tauri android build (after tauri android init)"
echo "  - iOS: tauri ios build (after tauri ios init)"