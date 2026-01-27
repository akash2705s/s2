const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  createOrUpdateAdConfig,
  getAllAdConfigs,
  getAdConfigByBrand,
  getAdConfigById,
  updateAdPlacement,
  updateTargeting,
  updatePlayback,
  toggleActiveStatus,
  deleteAdConfig
} = require('../actions/adConfigActions');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Create or update ad configuration for a brand
router.post('/', createOrUpdateAdConfig);

// Get all ad configurations for the authenticated user
router.get('/', getAllAdConfigs);

// Get ad configuration by brand ID
router.get('/brand/:brandId', getAdConfigByBrand);

// Get ad configuration by ID
router.get('/:id', getAdConfigById);

// Update ad placement settings
router.patch('/:id/placement', updateAdPlacement);

// Update targeting settings
router.patch('/:id/targeting', updateTargeting);

// Update playback settings
router.patch('/:id/playback', updatePlayback);

// Toggle active status
router.patch('/:id/toggle-active', toggleActiveStatus);

// Delete ad configuration
router.delete('/:id', deleteAdConfig);

module.exports = router;
