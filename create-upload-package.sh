#!/bin/bash

# Script to create a clean upload package for Let's Encrypt Certificate Generator

set -e  # Exit on any error

echo "=== Creating Upload Package for Let's Encrypt Certificate Generator ==="

# Create a clean temporary directory
TEMP_DIR="/tmp/letsencrypt-production"
echo "Creating clean directory at $TEMP_DIR..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"/{routes,services,views,public,data,certificates,sessions}

# Copy main files
echo "Copying main files..."
cp server.js package.json package-lock.json start-production.sh linode-production-setup.sh fix-permissions.sh deploy.sh "$TEMP_DIR/"

# Copy code directories
echo "Copying code directories..."
cp -r routes/*.js "$TEMP_DIR/routes/"
cp -r services/*.js "$TEMP_DIR/services/"
cp -r views/*.ejs "$TEMP_DIR/views/"
cp -r public/* "$TEMP_DIR/public/" 2>/dev/null || true

# Create production .env file
echo "Creating production .env file..."
cat > "$TEMP_DIR/.env" << EOL
PORT=3000
NODE_ENV=production
SESSION_SECRET=9400000d059d42307366a70cc774352f504267b0a4eae2d2d84e7db4344e6b79
DOMAIN=freesslcerts.com
ACME_DIRECTORY=production
EOL

# Create empty placeholder files to ensure directories exist
echo "Creating placeholder files..."
touch "$TEMP_DIR/data/.gitkeep"
touch "$TEMP_DIR/certificates/.gitkeep"
touch "$TEMP_DIR/sessions/.gitkeep"

# Create the archive
echo "Creating ZIP archive..."
cd /tmp
rm -f letsencrypt-production.zip
zip -r letsencrypt-production.zip letsencrypt-production

echo ""
echo "Upload package created at: /tmp/letsencrypt-production.zip"
echo "Size: $(du -h /tmp/letsencrypt-production.zip | cut -f1)"
echo ""
echo "Instructions:"
echo "1. Upload this ZIP file to your server"
echo "2. SSH into your server and run:"
echo "   unzip letsencrypt-production.zip -d /home/nodeuser/"
echo "   cd /home/nodeuser/letsencrypt-production"
echo "   mv * ../"
echo "   cd .."
echo "   rm -rf letsencrypt-production"
echo "   chmod +x deploy.sh"
echo "   ./deploy.sh"
echo "" 