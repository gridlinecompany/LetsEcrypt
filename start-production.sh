#!/bin/bash

# Navigate to application directory
cd "$(dirname "$0")"

# Install dependencies if needed
npm install

# Start application with PM2 in production mode
export NODE_ENV=production
export PORT=3000
export DOMAIN=freesslcerts.com
export ACME_DIRECTORY=production
export SESSION_SECRET=$(openssl rand -hex 32)

# Stop existing instance if running
pm2 stop letsencrypt-app 2>/dev/null || true

# Start the application
pm2 start server.js --name "letsencrypt-app" --env production

# Save PM2 configuration to survive system restarts
pm2 save

echo "Application started in production mode!"
echo "Visit https://freesslcerts.com to access your application" 