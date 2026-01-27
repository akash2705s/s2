const express = require("express");
const router = express.Router();
const TrackingEvent = require('../models/TrackingEvent'); // adjust path
const { getIPAndGeo } = require("../utils/ipGeolocation");

const {
    trackImpression,
    trackCreativeView,
    trackClick,
    trackVideoStart,
    trackVideoQuartile,
    trackVideoComplete,
} = require("../actions/trackingActions");

// Helper to save tracking event (shared for all routes)
const saveTrackingEvent = async (req, eventType, selectedValue = null) => {
    const { elementId } = req.params;
    const { interactionType, elementType, tv, campaignId, sessionId, ts } = req.query;

    console.log(`[Tracking] ${eventType}: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

    // Extract IP and geolocation data
    const geoData = await getIPAndGeo(req);

    await TrackingEvent.create({
        eventType,
        elementId,
        segmentId: null,
        interactionType: interactionType || null,
        elementType: elementType || null,
        tv: tv || "LG Free Movies Plus",
        ip: geoData.ip,
        userAgent: req.get("User-Agent"),
        city: geoData.city,
        region: geoData.region,
        country: geoData.country,
        country_name: geoData.country_name,
        latitude: geoData.latitude,
        longitude: geoData.longitude,
        timezone: geoData.timezone,
        isp: geoData.isp,
        org: geoData.org,
        campaignId: campaignId || null,
        sessionId: sessionId || null,
        timestamp: ts || Date.now(),
        selectedValue,
    });

    console.log(`[Tracking] ${eventType} saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
};

// Existing:
router.get("/impression/:elementId", trackImpression);
router.get("/creativeView/:elementId/:segmentId", trackCreativeView);
router.get("/click/:elementId/:segmentId", trackClick);
router.get("/creativeClick/:elementId/:segmentId", trackClick);// Keep typo for backward compatibility

// QR SHOWN TRACKING
router.get('/qrShown/:elementId', async (req, res) => {
    try {
        await saveTrackingEvent(req, 'qrShown');
        return res.status(204).send();
    } catch (error) {
        console.error("QrShown tracking error:", error);
        return res.sendStatus(500);
    }
});

// CLICK TRACKING
router.get('/click/:elementId', async (req, res) => {
    try {
        const selectedValue = req.query.value || null;
        await saveTrackingEvent(req, 'click', selectedValue);
        return res.status(204).send();
    } catch (error) {
        console.error("Click tracking error:", error);
        return res.sendStatus(500);
    }
});

// QR CLOSED TRACKING
router.get('/qrClosed/:elementId', async (req, res) => {
    try {
        await saveTrackingEvent(req, 'qrClosed');
        return res.status(204).send();
    } catch (error) {
        console.error("QrClosed tracking error:", error);
        return res.sendStatus(500);
    }
});

// QR OPENED TRACKING
router.get('/qrOpened/:elementId', async (req, res) => {
    try {
        await saveTrackingEvent(req, 'qrOpened');
        return res.status(204).send();
    } catch (error) {
        console.error("QrOpened tracking error:", error);
        return res.sendStatus(500);
    }
});

// NEW: Linear Video Tracking Routes
router.get("/start/:elementId", trackVideoStart);

router.get("/firstQuartile/:elementId",
    (req, res) => trackVideoQuartile({ ...req, params: { elementId: req.params.elementId, quartile: "firstQuartile" } }, res)
);

router.get("/midpoint/:elementId",
    (req, res) => trackVideoQuartile({ ...req, params: { elementId: req.params.elementId, quartile: "midpoint" } }, res)
);

router.get("/thirdQuartile/:elementId",
    (req, res) => trackVideoQuartile({ ...req, params: { elementId: req.params.elementId, quartile: "thirdQuartile" } }, res)
);

router.get("/complete/:elementId", trackVideoComplete);

module.exports = router;

