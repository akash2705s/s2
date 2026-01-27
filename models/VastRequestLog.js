const mongoose = require("mongoose");

const VastRequestLogSchema = new mongoose.Schema({
    vastBrandId: { type: String, required: true },
    ip: { type: String, required: true },
    userAgent: { type: String, default: null },
    path: { type: String, required: true },

    // Geolocation data
    city: { type: String, default: null },
    region: { type: String, default: null },
    country: { type: String, default: null },
    country_name: { type: String, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    timezone: { type: String, default: null },
    isp: { type: String, default: null },
    org: { type: String, default: null },

    timestamp: { type: Date, default: Date.now },
}, {
    timestamps: true
});

// Index for querying by brand and date
VastRequestLogSchema.index({ vastBrandId: 1, timestamp: -1 });
VastRequestLogSchema.index({ ip: 1, timestamp: -1 });

module.exports = mongoose.model("VastRequestLog", VastRequestLogSchema);

