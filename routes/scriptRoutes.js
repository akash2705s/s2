const express = require('express');
const router = express.Router();
const { generateEmbedScript } = require('../actions/scriptActions');
const { authenticateToken } = require('../middleware/auth');

// Generate embed script for an element
router.get('/embed/:elementId', authenticateToken, generateEmbedScript);

module.exports = router;

