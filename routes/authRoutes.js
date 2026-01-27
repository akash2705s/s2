const express = require('express');
const router = express.Router();
const { signup, signin, getCurrentUser } = require('../actions/authActions');
const { authenticateToken } = require('../middleware/auth');

// Public routes
router.post('/signup', signup);
router.post('/signin', signin);

// Protected routes
router.get('/me', authenticateToken, getCurrentUser);

module.exports = router;
