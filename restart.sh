#!/bin/bash

# restart.sh - Script to safely restart the Let's Encrypt certificate application

# Configuration
APP_DIR="/home/nodeuser/LetsEcrypt"
APP_NAME="LetsEcrypt"
NODE_ENV="production"
LOG_FILE="/var/log/letsecrypt-restart.log"

# Function to log messages
log_message() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Navigate to application directory
cd "$APP_DIR" || {
  log_message "ERROR: Could not change to directory $APP_DIR"
  exit 1
}

# Find and kill existing process
log_message "Looking for existing process..."
PID=$(pgrep -f "node.*server.js")

if [ -n "$PID" ]; then
  log_message "Stopping existing process (PID: $PID)..."
  kill -15 "$PID"
  sleep 5
  
  # Force kill if still running
  if ps -p "$PID" > /dev/null; then
    log_message "Process still running, force killing..."
    kill -9 "$PID"
    sleep 2
  fi
else
  log_message "No existing process found"
fi

# Ensure sessions directory exists
log_message "Ensuring sessions directory exists..."
node ensure-sessions.js

# Start the application
log_message "Starting $APP_NAME..."
export NODE_ENV="$NODE_ENV"
nohup node server.js >> /var/log/letsecrypt.log 2>&1 &

NEW_PID=$!
log_message "Started with PID: $NEW_PID"

# Verify the process is running
sleep 3
if ps -p "$NEW_PID" > /dev/null; then
  log_message "Process successfully started"
  exit 0
else
  log_message "ERROR: Process failed to start"
  exit 1
fi 