const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  createApiKey,
  getAllApiKeys,
  getApiKeysByBrand,
  getApiKeyById,
  updateApiKey,
  toggleApiKeyStatus,
  deleteApiKey,
  regenerateApiKey,
  verifyApiKey
} = require('../actions/apiKeyActions');

// Public endpoint for verifying API keys (no JWT required)
router.post('/verify', verifyApiKey);

// Apply authentication middleware to all other routes
router.use(authenticateToken);

// Create new API key
router.post('/', createApiKey);

// Get all API keys for authenticated user
router.get('/', getAllApiKeys);

// Get API keys by brand ID
router.get('/brand/:brandId', getApiKeysByBrand);

// Get API key by ID
router.get('/:id', getApiKeyById);

// Update API key
router.put('/:id', updateApiKey);

// Toggle API key active status
router.patch('/:id/toggle', toggleApiKeyStatus);

// Regenerate API key (creates new key, deactivates old)
router.post('/:id/regenerate', regenerateApiKey);

// Delete API key (soft delete by default, permanent with ?permanent=true)
router.delete('/:id', deleteApiKey);

module.exports = router;
