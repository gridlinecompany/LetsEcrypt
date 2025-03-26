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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
  store: new fileStore(),
  secret: process.env.SESSION_SECRET || 'letsencrypt-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week
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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 