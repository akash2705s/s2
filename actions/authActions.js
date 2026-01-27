const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/auth');
const { getPermissionsForRole } = require('../utils/permissions');

// Signup action
const signup = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      email,
      name: name || email.split('@')[0],
      password: hashedPassword
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return user data (without password) and token
    res.status(201).json({
      message: 'User created successfully',
      user: user.toJSON(),
      token
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Signin action
const signin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get user role and permissions
    const userRole = user.role || null;
    const permissions = userRole ? getPermissionsForRole(userRole) : [];

    // Generate JWT token (EXTENDED: embed role & permissions for downstream RBAC)
    const token = jwt.sign(
      { id: user._id, email: user.email, role: userRole, permissions },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return user data (without password) and token
    // EXTENDED: Added role, permissions, and user_id to response
    // Existing fields (message, user, token) remain unchanged for backward compatibility
    const userJson = user.toJSON();
    res.json({
      message: 'Signin successful',
      user: userJson,
      token,
      // New fields added to response
      user_id: user._id.toString(),
      role: userRole,
      permissions: permissions
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get current user action
const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('defaultBrandId', 'name description logo');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  signup,
  signin,
  getCurrentUser
};
