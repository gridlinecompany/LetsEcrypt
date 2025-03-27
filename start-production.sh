#!/bin/bash

# Production startup script for Let's Encrypt Certificate Generator

# Make script stop on first error
set -e

# Environment variables for production
export NODE_ENV=production
export ACME_DIRECTORY=production

# Check if .env file exists, create it if it doesn't
if [ ! -f .env ]; then
  echo "Creating .env file for production..."
  cat > .env << EOL
PORT=3000
NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
DOMAIN=freesslcerts.com
ACME_DIRECTORY=production
EOL
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install --production
fi

# Start the application with PM2
echo "Starting application with PM2..."
pm2 start server.js --name letsencrypt-app

echo "Application is running in production mode!"
echo "To view logs: pm2 logs letsencrypt-app"
echo "To restart: pm2 restart letsencrypt-app"

# Exit successfully
exit 0 