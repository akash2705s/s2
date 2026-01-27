const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  createCampaign,
  getCampaignsByBrand,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  addAdUnit,
  updateAdUnitStatus,
  removeAdUnit
} = require('../actions/campaignActions');

// All routes require authentication
router.use(authenticateToken);

// Create a new campaign
router.post('/', createCampaign);

// Get all campaigns for a brand
router.get('/brand/:brandId', getCampaignsByBrand);

// Get a single campaign
router.get('/:campaignId', getCampaign);

// Update a campaign
router.put('/:campaignId', updateCampaign);

// Delete a campaign
router.delete('/:campaignId', deleteCampaign);

// Add ad unit to campaign
router.post('/:campaignId/ad-units', addAdUnit);

// Update ad unit status
router.put('/:campaignId/ad-units/:adUnitId', updateAdUnitStatus);

// Remove ad unit from campaign
router.delete('/:campaignId/ad-units/:adUnitId', removeAdUnit);

module.exports = router;
