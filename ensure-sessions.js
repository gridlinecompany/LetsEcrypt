#!/usr/bin/env node

/**
 * ensure-sessions.js
 * 
 * Script to ensure the sessions directory exists and has proper permissions
 * This should be run before the server starts
 */

const fs = require('fs');
const path = require('path');

const SESSION_DIR = '/tmp/letsecrypt-sessions';

// Ensure the session directory exists
function ensureSessionDirectory() {
  console.log(`Ensuring session directory exists: ${SESSION_DIR}`);
  
  try {
    if (!fs.existsSync(SESSION_DIR)) {
      console.log('Creating session directory...');
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
    
    // Set proper permissions (readable/writable by the node process)
    fs.chmodSync(SESSION_DIR, '755');
    console.log('Session directory ready');
  } catch (error) {
    console.error('Error setting up session directory:', error);
    process.exit(1);
  }
}

// Run the function
ensureSessionDirectory(); 