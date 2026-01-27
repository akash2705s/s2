const mongoose = require("mongoose");

const TrackingEventSchema = new mongoose.Schema({
    elementId: { type: String, required: true },
    segmentId: { type: String, default: null },

    eventType: { type: String, required: true }, // impression, creativeView, click, start, complete...
    interactionType: { type: String, default: null }, // spin-wheel, gift-box, forms, poll, l-squeeze
    elementType: { type: String, default: null }, // l-banner, corner-banner, full-page-ad

    // Optional TV identifier (e.g., "LG Christmas Plus")
    tv: { type: String, default: null },

    userAgent: String,
    ip: String,

    // Geolocation data
    city: String,
    region: String,
    country: String,
    country_name: String,
    latitude: Number,
    longitude: Number,
    timezone: String,
    isp: String,
    org: String,

    timestamp: { type: Date, default: Date.now },

    campaignId: { type: String, default: null },
    sessionId: { type: String, default: null },
    selectedValue: { type: String, default: null },
});

module.exports = mongoose.model("TrackingEvent", TrackingEventSchema);
