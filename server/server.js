const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'formvault-super-secret-key-98765';

app.use(cors());
app.use(express.json());

// --- Authentication Middleware ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// --- Health / Diagnostic Route ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    database: db.getDbType(),
    time: new Date().toISOString()
  });
});

// --- Auth Routes ---

// Register
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  try {
    // Check if user already exists
    const existingUser = await db.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await db.createUser(email, passwordHash);
    res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Generate JWT (including creation timestamp for 24h client-side validation)
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      iat: Math.floor(Date.now() / 1000) // issued at
    };

    // JWT token is signed
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// --- Profile Routes ---

// Get all profiles (owned by user OR shared with user's email)
app.get('/api/profiles', authenticateToken, async (req, res) => {
  try {
    const profiles = await db.getProfilesForUser(req.user.userId, req.user.email);
    res.json(profiles);
  } catch (error) {
    console.error('Fetch profiles error:', error);
    res.status(500).json({ error: 'Server error fetching profiles' });
  }
});

// Create or Update Profile
app.post('/api/profiles', authenticateToken, async (req, res) => {
  const { id, name, fields, sharedWith } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Profile name is required' });
  }

  try {
    if (id) {
      // Update existing profile (verify ownership inside updateProfile)
      try {
        const updatedProfile = await db.updateProfile(id, req.user.userId, { name, fields, sharedWith });
        if (!updatedProfile) {
          return res.status(404).json({ error: 'Profile not found' });
        }
        res.json(updatedProfile);
      } catch (err) {
        if (err.message.includes('Unauthorized')) {
          return res.status(403).json({ error: 'You do not own this profile to modify it' });
        }
        throw err;
      }
    } else {
      // Create new profile
      const newProfile = await db.createProfile(name, fields, sharedWith, req.user.userId);
      res.status(201).json(newProfile);
    }
  } catch (error) {
    console.error('Save profile error:', error);
    res.status(500).json({ error: 'Server error saving profile' });
  }
});

// Delete Profile
app.delete('/api/profiles/:id', authenticateToken, async (req, res) => {
  const profileId = req.params.id;

  try {
    const success = await db.deleteProfile(profileId, req.user.userId);
    if (!success) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json({ message: 'Profile deleted successfully' });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return res.status(403).json({ error: 'You do not have permission to delete this profile' });
    }
    console.error('Delete profile error:', error);
    res.status(500).json({ error: 'Server error deleting profile' });
  }
});

app.listen(PORT, () => {
  console.log(`FormVault API Server running on port ${PORT}`);
});
