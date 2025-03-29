const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const certificateRoutes = require('./routes/certificates');
const userRoutes = require('./routes/users');
const session = require('express-session');
const fileStore = require('session-file-store')(session);

// Load environment variables
dotenv.config();

// Check for required environment variables
if (!process.env.SESSION_SECRET) {
  console.error('ERROR: SESSION_SECRET environment variable is required');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
  store: new fileStore({
    path: '/tmp/letsecrypt-sessions',
    ttl: 86400,  // 24 hours in seconds
    retries: 5,
    reapInterval: 3600  // 1 hour in seconds
  }),
  secret: process.env.SESSION_SECRET,
  resave: true,  // Changed to true to ensure session is saved
  saveUninitialized: true,  // Changed to true to create session for all requests
  rolling: true, // Reset maxAge on each response
  cookie: { 
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
    secure: isProduction,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Routes
app.get('/', (req, res) => {
  res.render('index', { user: req.session.user });
});

// Add direct routes for login and register
app.get('/login', (req, res) => {
  res.redirect('/users/login');
});

app.get('/register', (req, res) => {
  res.redirect('/users/register');
});

app.use('/users', userRoutes);
app.use('/certificates', requireAuth, certificateRoutes);

// Add production error handling middleware
if (isProduction) {
  // Production error handler - no stacktraces leaked to user
  app.use(function(err, req, res, next) {
    console.error(err.stack);
    res.status(err.status || 500);
    res.render('error', {
      message: 'An unexpected error occurred. Please try again later.',
      user: req.session.user
    });
  });
} else {
  // Development error handler - with stacktraces
  app.use(function(err, req, res, next) {
    console.error(err.stack);
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err,
      user: req.session.user
    });
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on ${isProduction ? 'https' : 'http'}://${process.env.DOMAIN || 'localhost'}:${PORT}`);
}); 