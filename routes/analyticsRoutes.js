const express = require("express");
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');


const {
    getPublisherAnalytics,
    getDspAnalytics,
    getBrandAnalytics,
    getGeneralAnalytics,
    getPublisherPlots,
    getAnalytics,
} = require("../actions/analyticsActions");

// Publisher Analytics
router.get('/publisher-analytics', authenticateToken, getPublisherAnalytics);
router.get('/plots', authenticateToken, getPublisherPlots);

// DSP Analytics
router.get('/dsp-analytics', authenticateToken, getPublisherAnalytics);

// Brand Analytics
router.get('/brand-analytics', authenticateToken, getPublisherAnalytics);

// General Analytics (for Analytics.jsx)
router.get('/analytics', authenticateToken, getGeneralAnalytics);

// Fetch analytics for one element
router.get("/:elementId",getAnalytics);

module.exports = router;
