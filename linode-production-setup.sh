#!/bin/bash

# Linode server production setup script for Let's Encrypt Certificate Generator
# Run as the nodeuser with sudo privileges

set -e

echo "Setting up production environment for Let's Encrypt Certificate Generator..."

# Create application directory if it doesn't exist
if [ ! -d "/home/nodeuser/LetsEcrypt" ]; then
  echo "Creating application directory..."
  mkdir -p /home/nodeuser/LetsEcrypt
fi

# Navigate to application directory
cd /home/nodeuser/LetsEcrypt

# Create production .env file
echo "Creating production .env file..."
cat > .env << EOL
PORT=3000
NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
DOMAIN=freesslcerts.com
ACME_DIRECTORY=production
EOL

# Set proper permissions
chmod 600 .env

# Delete any previous test files
echo "Removing test files..."
rm -f trace-dns-challenge.js
rm -f test-dns.js
rm -f linode-fix.js
rm -f dns-challenge-result.json

# Make sure we have the certificates directory
mkdir -p certificates
chmod 700 certificates

# Make sure we have the data directory
mkdir -p data
chmod 700 data

# Ensure pm2 is installed globally
echo "Ensuring PM2 is installed..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
fi

# Configure PM2 to start on system boot
echo "Configuring PM2 for system startup..."
pm2 startup

# Stop any existing instance
pm2 stop letsencrypt-app 2>/dev/null || true

# Start the application using the production script
echo "Starting the application..."
bash start-production.sh

# Save the PM2 configuration
pm2 save

echo "Production environment setup complete!"
echo "Your Let's Encrypt Certificate Generator is now running in production mode."
echo "Visit https://freesslcerts.com to access your application" 