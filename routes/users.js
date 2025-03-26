const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Simple file-based user storage
const USER_FILE = path.join(__dirname, '../data/users.json');
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize users file if it doesn't exist
if (!fs.existsSync(USER_FILE)) {
  fs.writeFileSync(USER_FILE, JSON.stringify([], null, 2));
}

// Helper functions
function getUsers() {
  const data = fs.readFileSync(USER_FILE, 'utf8');
  return JSON.parse(data);
}

function saveUsers(users) {
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, hash, salt) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

// Login page
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Registration page
router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// Handle login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const users = getUsers();
  
  const user = users.find(u => u.email === email);
  if (!user) {
    return res.render('login', { error: 'Invalid email or password' });
  }
  
  if (!verifyPassword(password, user.hash, user.salt)) {
    return res.render('login', { error: 'Invalid email or password' });
  }
  
  // Save user to session
  req.session.user = {
    id: user.id,
    email: user.email,
    name: user.name
  };
  
  res.redirect('/certificates/dashboard');
});

// Handle registration
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  
  // Validation
  if (!name || !email || !password) {
    return res.render('register', { error: 'All fields are required' });
  }
  
  const users = getUsers();
  
  // Check if user already exists
  if (users.find(u => u.email === email)) {
    return res.render('register', { error: 'Email already registered' });
  }
  
  // Create user
  const { salt, hash } = hashPassword(password);
  const newUser = {
    id: Date.now().toString(),
    name,
    email,
    salt,
    hash,
    created: new Date().toISOString()
  };
  
  users.push(newUser);
  saveUsers(users);
  
  // Log user in
  req.session.user = {
    id: newUser.id,
    email: newUser.email,
    name: newUser.name
  };
  
  res.redirect('/certificates/dashboard');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router; 