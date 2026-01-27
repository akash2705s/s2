const express = require("express");
const router = express.Router();
const vastBrandActions = require("../actions/vastBrandActions");
const { authenticateToken } = require('../middleware/auth');

// Generate & store all VAST XML for given brand
router.post("/campaign/:campaignId/generate", authenticateToken, vastBrandActions.generateRandomCampaignVast);
router.post("/brand/:brandId/generate", authenticateToken, vastBrandActions.generateAllBrandVast);


// Get random VAST XML for brand (excluding seen)
router.get("/brand/:brandId/random", vastBrandActions.getRandomBrandVast);
router.get("/campaign/:campaignId/random", vastBrandActions.getRandomCampaignVast);

module.exports = router;
