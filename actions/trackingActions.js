const TrackingEvent = require("../models/TrackingEvent");
const { getIPAndGeo } = require("../utils/ipGeolocation");


/**
 * IMPRESSION TRACKING
 * Fires when ad is served.
 */
exports.trackImpression = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv, campaignId, sessionId, ts } = req.query;

        console.log(`[Tracking] Impression: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "impression",
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
            selectedValue: null,
        });

        console.log(`[Tracking] Impression saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("Impression tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * CREATIVE VIEW TRACKING
 * Fires when ad is viewed for a short time.
 */
exports.trackCreativeView = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv, campaignId, sessionId, ts } = req.query;

        console.log(`[Tracking] CreativeView: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "creativeView",
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
            selectedValue: null,
        });

        console.log(`[Tracking] CreativeView saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("CreativeView tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * CLICK TRACKING
 * Fires on poll selection.
 */
exports.trackClick = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv, campaignId, sessionId, ts, value } = req.query;

        console.log(`[Tracking] Click: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}, value=${value}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "click",
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
            selectedValue: value || null,
        });

        console.log(`[Tracking] Click saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("Click tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * COMPLETE TRACKING
 * Fires when ad completes.
 */
exports.trackComplete = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv, campaignId, sessionId, ts } = req.query;

        console.log(`[Tracking] Complete: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "complete",
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
            selectedValue: null,
        });

        console.log(`[Tracking] Complete saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("Complete tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * CLOSE TRACKING
 * Fires when ad is closed.
 */
exports.trackClose = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv, campaignId, sessionId, ts } = req.query;

        console.log(`[Tracking] Close: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "close",
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
            selectedValue: null,
        });

        console.log(`[Tracking] Close saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("Close tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * QR SHOWN TRACKING
 * Fires when QR is shown.
 */
exports.trackQrShown = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv, campaignId, sessionId, ts } = req.query;

        console.log(`[Tracking] QrShown: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "qrShown",
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
            selectedValue: null,
        });

        console.log(`[Tracking] QrShown saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("QrShown tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * QR CLOSED TRACKING
 * Fires when QR is closed/hidden.
 */
exports.trackQrClosed = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv, campaignId, sessionId, ts } = req.query;

        console.log(`[Tracking] QrClosed: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "qrClosed",
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
            selectedValue: null,
        });

        console.log(`[Tracking] QrClosed saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("QrClosed tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * QR OPENED TRACKING
 * Fires when QR is opened (e.g., scanned).
 */
exports.trackQrOpened = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv, campaignId, sessionId, ts } = req.query;

        console.log(`[Tracking] QrOpened: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "qrOpened",
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
            selectedValue: null,
        });

        console.log(`[Tracking] QrOpened saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("QrOpened tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * IMPRESSION TRACKING
 * Fires when ad is served.
 */
exports.trackImpression_old = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { interactionType, elementType, tv } = req.query;

        console.log(`[Tracking] Impression: elementId=${elementId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "impression",
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
        });

        console.log(`[Tracking] Impression saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("Impression tracking error:", error);
        return res.sendStatus(500);
    }
};

exports.trackVideoStart = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { tv } = req.query;

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "start",
            elementId,
            segmentId: null,
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
        });

        console.log(`[Tracking] Video start saved for elementId: ${elementId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (e) {
        console.error("start tracking error:", e);
        return res.sendStatus(500);
    }
};

exports.trackVideoQuartile = async (req, res) => {
    try {
        const { elementId, quartile } = req.params;
        const { tv } = req.query;

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: quartile,   // firstQuartile, midpoint, thirdQuartile
            elementId,
            segmentId: null,
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
        });

        console.log(`[Tracking] Video ${quartile} saved for elementId: ${elementId}, IP: ${geoData.ip}`);
        return res.status(204).send();
    } catch (e) {
        console.error("quartile tracking error:", e);
        return res.sendStatus(500);
    }
};

exports.trackVideoComplete = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { tv } = req.query;

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "complete",
            elementId,
            segmentId: null,
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
        });

        console.log(`[Tracking] Video complete saved for elementId: ${elementId}, IP: ${geoData.ip}`);
        return res.status(204).send();
    } catch (e) {
        console.error("complete tracking error:", e);
        return res.sendStatus(500);
    }
};


/**
 * CREATIVE VIEW (NonLinear image was shown)
 */
exports.trackCreativeView = async (req, res) => {
    try {
        const { elementId, segmentId } = req.params;
        const { interactionType, elementType, tv } = req.query;

        console.log(`[Tracking] CreativeView: elementId=${elementId}, segmentId=${segmentId}, interactionType=${interactionType}, elementType=${elementType}`);

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "creativeView",
            elementId,
            segmentId,
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
        });

        console.log(`[Tracking] CreativeView saved for elementId: ${elementId}, segmentId: ${segmentId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);
        return res.status(204).send();
    } catch (error) {
        console.error("Creative view tracking error:", error);
        return res.sendStatus(500);
    }
};

/**
 * CLICK TRACKING + OPTIONAL REDIRECT
 */
exports.trackClick = async (req, res) => {
    try {
        const { elementId, segmentId } = req.params;
        const redirectUrl = req.query.redirect;
        const { interactionType, elementType, tv } = req.query;

        // Extract IP and geolocation data
        const geoData = await getIPAndGeo(req);

        await TrackingEvent.create({
            eventType: "click",
            elementId,
            segmentId,
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
        });

        console.log(`[Tracking] Click saved for elementId: ${elementId}, segmentId: ${segmentId}, IP: ${geoData.ip}, Location: ${geoData.city || 'Unknown'}, ${geoData.country || 'Unknown'}`);

        // If redirect param found → redirect user
        if (redirectUrl) {
            return res.redirect(302, redirectUrl);
        }

        return res.status(204).send();
    } catch (error) {
        console.error("Click tracking error:", error);
        return res.sendStatus(500);
    }
};
