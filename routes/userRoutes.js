const express = require('express');
const router = express.Router();
const { createUser } = require('../actions/userActions');
const { authenticateToken } = require('../middleware/auth');
const { superAdminOnly } = require('../middleware/roleGuard');

// All user routes require SuperAdmin role
router.post('/create', authenticateToken, superAdminOnly, createUser);

module.exports = router;
