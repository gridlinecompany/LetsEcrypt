#!/bin/bash

# Deployment script for Let's Encrypt Certificate Generator
# Run this script after uploading and extracting the archive

set -e  # Exit on any error

# Set the application directory - change this if needed
APP_DIR="/home/nodeuser/LetsEcrypt"

echo "=== Deploying Let's Encrypt Certificate Generator ==="
echo "Application directory: $APP_DIR"

# Check if directory exists
if [ ! -d "$APP_DIR" ]; then
  echo "ERROR: Directory $APP_DIR doesn't exist!"
  exit 1
fi

# Navigate to app directory
cd "$APP_DIR"

# Fix permissions first
echo "Fixing permissions..."
chmod +x ./fix-permissions.sh
./fix-permissions.sh

# Install production dependencies
echo "Installing dependencies..."
npm install --production

# Make sure PM2 is installed
if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2 globally..."
  npm install -g pm2
fi

# Stop the application if it's already running
echo "Stopping any existing application..."
pm2 stop letsencrypt-app 2>/dev/null || true

# Start the application with PM2
echo "Starting the application..."
chmod +x ./start-production.sh
./start-production.sh

# Save PM2 configuration
echo "Saving PM2 configuration..."
pm2 save

# Set up PM2 to start on system boot
echo "Setting up PM2 to run on system startup..."
pm2 startup

echo ""
echo "Deployment complete! The application is now running."
echo "Visit https://freesslcerts.com to access your application."
echo ""
echo "To check application logs:"
echo "  pm2 logs letsencrypt-app"
echo ""
echo "To restart the application:"
echo "  pm2 restart letsencrypt-app"
echo ""
echo "If you encounter any issues, check the logs for details."
echo "" 