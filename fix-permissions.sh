#!/bin/bash

# Script to fix permissions for Let's Encrypt Certificate Generator
# Run this script after extracting the archive on your server

set -e  # Exit on any error

# Set the application directory - change this if needed
APP_DIR="/home/nodeuser/LetsEcrypt"

# Get the current user
CURRENT_USER=$(whoami)

echo "=== Fixing permissions for Let's Encrypt Certificate Generator ==="
echo "Application directory: $APP_DIR"
echo "Current user: $CURRENT_USER"

# Create directories if they don't exist
echo "Creating required directories..."
mkdir -p "$APP_DIR/data"
mkdir -p "$APP_DIR/certificates"
mkdir -p "$APP_DIR/sessions"

# Set executable permissions for scripts
echo "Setting executable permissions for scripts..."
chmod +x "$APP_DIR/start-production.sh"
chmod +x "$APP_DIR/linode-production-setup.sh"
chmod +x "$APP_DIR/fix-permissions.sh"

# Set secure permissions for sensitive files
echo "Setting secure permissions for sensitive files..."
chmod 600 "$APP_DIR/.env"

# Set correct permissions for data directories
echo "Setting permissions for data directories..."
chmod 770 "$APP_DIR/data"
chmod 770 "$APP_DIR/certificates"
chmod 770 "$APP_DIR/sessions"

# Set standard permissions for code files
echo "Setting permissions for code files..."
find "$APP_DIR/routes" -type f -name "*.js" -exec chmod 644 {} \;
find "$APP_DIR/services" -type f -name "*.js" -exec chmod 644 {} \;
find "$APP_DIR/views" -type f -name "*.ejs" -exec chmod 644 {} \;
find "$APP_DIR/public" -type f -exec chmod 644 {} \;
chmod 644 "$APP_DIR/server.js"
chmod 644 "$APP_DIR/package.json"
chmod 644 "$APP_DIR/package-lock.json"

# If run as root, change ownership to nodeuser (or your app user)
if [ "$EUID" -eq 0 ]; then
  echo "Running as root, changing ownership to nodeuser..."
  chown -R nodeuser:nodeuser "$APP_DIR"
else
  echo "Not running as root, skipping ownership change."
  echo "If needed, run 'sudo chown -R nodeuser:nodeuser $APP_DIR' later."
fi

# Verify data directory is writable
if [ -w "$APP_DIR/data" ]; then
  echo "✓ Data directory is writable"
else
  echo "✗ ERROR: Data directory is not writable!"
  echo "Run: sudo chmod 770 $APP_DIR/data"
  echo "Run: sudo chown -R nodeuser:nodeuser $APP_DIR/data"
fi

# Verify certificates directory is writable
if [ -w "$APP_DIR/certificates" ]; then
  echo "✓ Certificates directory is writable"
else
  echo "✗ ERROR: Certificates directory is not writable!"
  echo "Run: sudo chmod 770 $APP_DIR/certificates"
  echo "Run: sudo chown -R nodeuser:nodeuser $APP_DIR/certificates"
fi

# Verify sessions directory is writable
if [ -w "$APP_DIR/sessions" ]; then
  echo "✓ Sessions directory is writable"
else
  echo "✗ ERROR: Sessions directory is not writable!"
  echo "Run: sudo chmod 770 $APP_DIR/sessions"
  echo "Run: sudo chown -R nodeuser:nodeuser $APP_DIR/sessions"
fi

echo ""
echo "Permissions have been fixed!"
echo "If you still encounter permission errors, run this script as root:"
echo "sudo ./fix-permissions.sh"
echo ""
echo "Next steps:"
echo "1. Install dependencies:   npm install --production"
echo "2. Start the application:  ./start-production.sh"
echo "" 