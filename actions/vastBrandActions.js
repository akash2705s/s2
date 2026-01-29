const Element = require("../models/OverlayElement");
const Campaign = require("../models/Campaign");
const Brand = require("../models/Brand");
const xmlbuilder = require("xmlbuilder");
const { uploadToS3, getFromS3 } = require("../config/s3Helper");
const vastActions = require("./vastActions");
const mongoose = require('mongoose');
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../config/aws");
const bucket = process.env.S3_BUCKET_NAME;
const { getIPAndGeo } = require("../utils/ipGeolocation");
const VastRequestLog = require("../models/VastRequestLog");

// Allowed CTV / OEM platforms for tv filter
const ALLOWED_TV_PLATFORMS = new Set(['LG', 'Roku', 'VIZIO', 'Samsung', 'Fire TV']);

function canonicalizePlatform(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const u = raw.toUpperCase();
    if (u === 'ROKU') return 'Roku';
    if (u === 'LG') return 'LG';
    if (u === 'VIZIO') return 'VIZIO';
    if (u === 'SAMSUNG') return 'Samsung';
    if (u === 'FIRETV' || u === 'FIRE' || u === 'FIRE_TV' || u === 'FIRE TV') return 'Fire TV';
    return raw;
}

/**
 * Parse tv query param into a single OEM platform.
 *
 * Supported formats (single value only):
 * - ?tv=LG
 * - ?tv=lg
 * - ?tv=(LG)
 *
 * Multi-value formats like ?tv=LG,Roku or ?tv=(LG,Roku,Vizio) are rejected.
 */
function parseTvPlatforms(tvParam) {
    if (tvParam === undefined || tvParam === null) {
        return { platforms: [] };
    }

    const raw = String(tvParam).trim();
    if (!raw) {
        return { platforms: [] };
    }

    // Reject any commas or multiple values
    if (raw.includes(',')) {
        return { error: "tv must be a single OEM value like ?tv=LG" };
    }

    // Allow optional surrounding parentheses: "(LG)" -> "LG"
    const stripped = raw.replace(/^\(/, '').replace(/\)$/, '');

    const canonical = canonicalizePlatform(stripped);
    if (!canonical || !ALLOWED_TV_PLATFORMS.has(canonical)) {
        return {
            error: `unsupported tv platform '${stripped}'. allowed: ${Array.from(ALLOWED_TV_PLATFORMS).join(', ')}`
        };
    }

    return { platforms: [canonical] };
}

// Helper: clean XML string to remove duplicate declarations (same as in vastActions.js)
function cleanXmlString(xmlString) {
    if (!xmlString) return xmlString;
    // Remove duplicate XML declarations (keep only the first one)
    return xmlString.replace(/^<\?xml[^>]*\?>\s*<\?xml[^>]*\?>/m, '<?xml version="1.0" encoding="UTF-8"?>');
}

// Helper: check if VAST exists in S3 (same as in vastActions.js)
async function checkS3Cache(elementId) {
    try {
        const key = `vast/${elementId}.xml`;
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const response = await s3Client.send(cmd);
        const body = await response.Body.transformToString();
        // Clean any duplicate XML declarations from cached XML and trim whitespace
        return cleanXmlString(body.trim());
    } catch (err) {
        return null; // not in cache
    }
}


exports.getRandomCampaignVast = async (req, res) => {
    const { campaignId } = req.params;
    const forceGenerate = req.query.forceGenerate === 'true' || req.query.forceGenerate === 'True';
    const adUnitsParam = req.query.adUnits;
    const includeAdUnits = adUnitsParam
        ? String(adUnitsParam)
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
        : undefined;

    if (!campaignId || typeof campaignId !== 'string' || campaignId.length !== 24) {
        return res.status(400).json({ error: "Invalid campaign ID format" });
    }

    const s3Key = `vast/campaign/${campaignId}.xml`;

    try {
        // 1. Log the request BEFORE serving (mirrors getRandomBrandVast)
        const geoData = await getIPAndGeo(req);

        await VastRequestLog.create({
            vastBrandId: campaignId,          // ← we're using the same field name, but it now means campaignId
            // If you want to distinguish later, add a new field like campaignId: campaignId
            ip: geoData.ip,
            userAgent: req.headers['user-agent'] || null,
            path: req.originalUrl || `/api/vastBrand/campaign/${campaignId}/random`,

            city: geoData.city,
            region: geoData.region,
            country: geoData.country,
            country_name: geoData.country_name,
            latitude: geoData.latitude,
            longitude: geoData.longitude,
            timezone: geoData.timezone,
            isp: geoData.isp,
            org: geoData.org,

            timestamp: new Date(),
        });

        console.log(`[VAST Request Log] Campaign ${campaignId} requested from IP ${geoData.ip} (${geoData.city || 'unknown'}, ${geoData.country || 'unknown'})${forceGenerate ? ' [FORCE REGENERATE]' : ''}${includeAdUnits && includeAdUnits.length ? ` [AD_UNITS=${includeAdUnits.join(',')}]` : ''}`);

        // 2. If forceGenerate is true, regenerate and return
        if (forceGenerate) {
            try {
                const generated = await generateCombinedCampaignVast(campaignId, { includeAdUnits });
                res.set({
                    'Content-Type': 'application/xml',
                    'Content-Disposition': `inline; filename="campaign-${campaignId}-vast.xml"`,
                    'Cache-Control': 'no-cache',
                });
                res.send(generated.xml);
                return;
            } catch (genErr) {
                console.error(`[VAST Force Generate Error] Campaign ${campaignId}:`, genErr);
                return res.status(500).json({ error: "Failed to generate campaign VAST", details: genErr.message });
            }
        }

        // 3. Fetch from S3
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: s3Key,
        });

        const data = await s3Client.send(command);

        // 4. Stream response
        res.set({
            'Content-Type': 'application/xml',
            'Content-Disposition': `inline; filename="campaign-${campaignId}-vast.xml"`,
            'Cache-Control': 'public, max-age=300',
        });

        data.Body.pipe(res);

    } catch (err) {
        if (err.name === 'NoSuchKey') {
            // Fallback: generate on demand if missing
            try {
                const generated = await generateCombinedCampaignVast(campaignId);
                res.set('Content-Type', 'application/xml');
                res.send(generated.xml);
            } catch (genErr) {
                res.status(500).json({ error: "Failed to generate campaign VAST" });
            }
        } else {
            console.error(`[VAST Campaign Error] ${s3Key}:`, err);
            res.status(500).json({ error: "Failed to retrieve campaign VAST" });
        }
    }
};


exports.getRandomBrandVast = async (req, res) => {
    const { brandId } = req.params;
    const forceGenerate = req.query.forceGenerate === 'true' || req.query.forceGenerate === 'True';
    const tvParsed = parseTvPlatforms(req.query.tv);
    if (tvParsed?.error) {
        return res.status(400).json({ error: tvParsed.error });
    }
    const tvPlatforms = tvParsed.platforms || [];

    if (!brandId || typeof brandId !== 'string') {
        return res.status(400).json({ error: "Invalid brand ID format" });
    }

    try {
        // 1. Log the request BEFORE serving
        const geoData = await getIPAndGeo(req);

        await VastRequestLog.create({
            vastBrandId: brandId,
            ip: geoData.ip,
            userAgent: req.headers['user-agent'] || null,
            path: req.originalUrl || `/api/vastBrand/brand/${brandId}/random`,

            city: geoData.city,
            region: geoData.region,
            country: geoData.country,
            country_name: geoData.country_name,
            latitude: geoData.latitude,
            longitude: geoData.longitude,
            timezone: geoData.timezone,
            isp: geoData.isp,
            org: geoData.org,

            timestamp: new Date(),
        });

        console.log(
            `[VAST Request Log] Brand ${brandId} requested from IP ${geoData.ip} (${geoData.city || 'unknown'}, ${geoData.country || 'unknown'})` +
            `${forceGenerate ? ' [FORCE REGENERATE]' : ''}` +
            `${tvPlatforms.length ? ` [TV=${tvPlatforms.join(',')}]` : ''}`
        );

        // 2. Always generate on demand (cache bypassed), tv filter is optional
        const generated = await generateCombinedBrandVasts(brandId, { tvPlatforms });
        res.set({
            'Content-Type': 'application/xml',
            'Content-Disposition': `inline; filename="brand-${brandId}-vast.xml"`,
            'Cache-Control': 'no-cache',
        });
        res.send(generated.xml);
    } catch (err) {
        console.error(`[VAST Brand Error] brand=${brandId}:`, err);

        // If generation code already returned an empty brand VAST (no matching elements),
        // respond with a valid, empty VAST instead of JSON error.
        if (err && typeof err.message === 'string' && err.message.includes('No matching elements found for running ad units')) {
            const emptyVast = xmlbuilder.begin()
                .dec({ version: "1.0", encoding: "UTF-8" })
                .ele("VAST")
                .att("version", "4.1")
                .att("xmlns", "http://www.iab.com/VAST")
                .att("xmlns:xs", "http://www.w3.org/2001/XMLSchema")
                .att("xmlns:canvas", "http://canvas-siau.com/extensions")
                .end({ pretty: true });

            res.set({
                'Content-Type': 'application/xml',
                'Content-Disposition': `inline; filename="brand-${brandId}-vast.xml"`,
                'Cache-Control': 'no-cache',
            });
            return res.send(emptyVast);
        }

        return res.status(500).json({ error: "Failed to generate brand VAST", details: err.message });
    }
};

// 🟦 2) Get Random & Unique VAST
exports.generateRandomCampaignVast = async (req, res) => {
    try {
        const campaignId = req.params.campaignId;  // ← clean string "6971a0f72caa535f9dbbf997"

        // Optional: quick format check (your IDs are 24-char hex)
        if (!/^[0-9a-fA-F]{24}$/.test(campaignId)) {
            return res.status(400).json({ error: "Invalid campaign ID format" });
        }

        const result = await generateCombinedCampaignVast(campaignId);  // ← pass string only

        res.json({
            success: true,
            s3Key: result.s3Key,
            adCount: result.adCount || 0,
            message: "VAST generated and saved to S3"
        });
    } catch (err) {
        console.error("VAST generate error:", err);
        if (err.name === 'CastError') {
            return res.status(400).json({ error: "Invalid campaign ID - casting failed" });
        }
        res.status(500).json({ error: err.message || "Failed to generate VAST" });
    }
}

async function generateCombinedBrandVast(brandId) {
    // 1. Fetch campaign and verify
    const campaign = await Brand.findById(campaignId);
    if (!campaign) {
        throw new Error(`Campaign not found: ${campaignId}`);
    }
}
/**
 * Generates a combined VAST XML for a campaign.
 * - Only includes "running" ad units
 * - If campaign.status !== 'active' or there are no running ad units, returns an empty VAST
 * - Saves to S3 under vast/campaign/{campaignId}.xml when generating the full campaign VAST
 * - When called with includeAdUnits, filters to that subset and does NOT overwrite the cached S3 VAST
 *   Returns { xml: string, s3Key: string, saved: boolean, adCount: number }
 */
async function generateCombinedCampaignVast(campaignId, options = {}) {

    const { includeAdUnits } = options;

    // 1. Fetch campaign and verify
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
        throw new Error(`Campaign not found: ${campaignId}`);
    }

    // Helper to build an empty VAST document
    const buildEmptyVast = () => {
        const emptyVast = xmlbuilder.begin()
            .dec({ version: "1.0", encoding: "UTF-8" })
            .ele("VAST")
            .att("version", "4.1")
            .att("xmlns", "http://www.iab.com/VAST")
            .att("xmlns:xs", "http://www.w3.org/2001/XMLSchema")
            .att("xmlns:canvas", "http://canvas-siau.com/extensions");

        return emptyVast.end({ pretty: true });
    };

    // If campaign is not active, return an empty VAST (treat as fully stopped)
    if (campaign.status && campaign.status !== 'active') {
        console.log(`[VAST] Campaign ${campaignId} is '${campaign.status}', returning empty VAST.`);
        const xmlString = buildEmptyVast();
        const s3Key = `vast/campaign/${campaignId}.xml`;

        // For full campaign generation, overwrite cache with empty VAST
        if (!includeAdUnits || includeAdUnits.length === 0) {
            await uploadToS3(s3Key, xmlString);
        }

        return {
            xml: xmlString,
            s3Key,
            saved: !includeAdUnits || includeAdUnits.length === 0,
            adCount: 0,
            campaignName: campaign.name,
        };
    }

    // 2. Filter only running ad units
    let runningAdUnits = campaign.adUnits.filter(
        (unit) => unit.status === "running"
    );

    console.log(`[VAST] Campaign ${campaignId} has ${campaign.adUnits.length} total ad units, ${runningAdUnits.length} with status "running"`);
    runningAdUnits.forEach((unit, idx) => {
        console.log(`[VAST] Running ad unit ${idx + 1}: elementId=${unit.elementId}, environment=${unit.environment}, status=${unit.status}`);
    });

    // Optionally filter to a subset of adUnits (by elementId)
    if (includeAdUnits && Array.isArray(includeAdUnits) && includeAdUnits.length > 0) {
        const includeSet = new Set(includeAdUnits.map(String));
        runningAdUnits = runningAdUnits.filter(unit =>
            includeSet.has(String(unit.elementId))
        );
        console.log(`[VAST] After filtering by includeAdUnits, ${runningAdUnits.length} ad units remain`);
    }

    if (runningAdUnits.length === 0) {
        console.log(`[VAST] Campaign ${campaignId} has no running ad units after filtering. Returning empty VAST.`);
        const xmlString = buildEmptyVast();
        const s3Key = `vast/campaign/${campaignId}.xml`;

        if (!includeAdUnits || includeAdUnits.length === 0) {
            await uploadToS3(s3Key, xmlString);
        }

        return {
            xml: xmlString,
            s3Key,
            saved: !includeAdUnits || includeAdUnits.length === 0,
            adCount: 0,
            campaignName: campaign.name,
        };
    }

    // Build elementId -> Set(environments) so we can inject platform/OEM into VAST
    const platformsByElementId = new Map();
    runningAdUnits.forEach((unit) => {
        const key = String(unit.elementId);
        if (!platformsByElementId.has(key)) platformsByElementId.set(key, new Set());
        if (unit.environment) {
            platformsByElementId.get(key).add(canonicalizePlatform(unit.environment) || unit.environment);
        }
    });

    // 3. Fetch full elements (Element docs)
    // Ensure all elementIds are strings (OverlayElement uses String _id)
    const elementIds = runningAdUnits.map((u) => String(u.elementId)).filter(Boolean);
    console.log(`[VAST] Searching for ${elementIds.length} elements with IDs:`, elementIds);

    // Query using string IDs (OverlayElement schema uses String _id)
    const elements = await Element.find({
        _id: { $in: elementIds },
    }).lean(); // lean for performance

    console.log(`[VAST] Found ${elements.length} matching elements out of ${elementIds.length} searched`);
    elements.forEach((elem, idx) => {
        console.log(`[VAST] Found element ${idx + 1}: _id=${elem._id} (type: ${typeof elem._id}), type=${elem.meta?.elementType || 'unknown'}, title=${elem.meta?.title || 'Untitled'}`);
    });

    // Check for missing elements - compare as strings
    const foundElementIds = new Set(elements.map(e => String(e._id)));
    const missingElementIds = elementIds.filter(id => !foundElementIds.has(String(id)));
    if (missingElementIds.length > 0) {
        console.warn(`[VAST] WARNING: ${missingElementIds.length} element(s) not found in database:`, missingElementIds);
        console.warn(`[VAST] These ad units will be excluded from VAST. Check if elements exist or if there's an ID mismatch.`);
        console.warn(`[VAST] Found element IDs:`, Array.from(foundElementIds));
        console.warn(`[VAST] Missing element IDs:`, missingElementIds);
    }

    if (elements.length === 0) {
        throw new Error(`No matching elements found for running ad units. Searched for: ${elementIds.join(', ')}`);
    }

    // 4. Build VAST root with correct XML declaration and VAST version
    const vast = xmlbuilder.begin()
        .dec({ version: "1.0", encoding: "UTF-8" })
        .ele("VAST")
        .att("version", "4.1")
        .att("xmlns", "http://www.iab.com/VAST")
        .att("xmlns:xs", "http://www.w3.org/2001/XMLSchema");

    // Add custom extensions namespace if needed (e.g., for LG-specific or QR hints)
    vast.att("xmlns:canvas", "http://canvas-siau.com/extensions");

    // Helper function to convert S3 URL to CDN URL
    const convertS3ToCdn = (url) => {
        if (!url || typeof url !== 'string') return url;

        // Skip if already CDN URL
        if (url.includes('images.ads.canvas.space')) return url;

        // Check if it's an S3 URL (cis-v1.s3.us-east-2.amazonaws.com or similar)
        // Pattern: https://bucket.s3.region.amazonaws.com/path?query
        // Example: https://cis-v1.s3.us-east-2.amazonaws.com/uploads/file.png?query
        const s3Pattern = /https?:\/\/([^\/]+)\.s3\.([^\/]+)\.amazonaws\.com\/([^?]+)/;
        const match = url.match(s3Pattern);

        if (match) {
            // Extract the S3 key (path after bucket name, before query params)
            const s3Key = match[3];
            // Convert to CDN URL (strip query parameters)
            return `https://images.ads.canvas.space/${s3Key}`;
        }

        // Also handle S3 URLs with different formats (e.g., s3://bucket/key or s3.amazonaws.com/bucket/key)
        const s3AltPattern = /https?:\/\/s3\.([^\/]+)\.amazonaws\.com\/([^\/]+)\/([^?]+)/;
        const altMatch = url.match(s3AltPattern);
        if (altMatch) {
            const bucket = altMatch[2];
            const key = altMatch[3];
            return `https://images.ads.canvas.space/${key}`;
        }

        // If not S3 URL, return as-is
        return url;
    };

    // Helper function to recursively convert S3 URLs to CDN URLs in configuration
    const convertConfigUrlsToCdn = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;

        if (Array.isArray(obj)) {
            return obj.map(item => convertConfigUrlsToCdn(item));
        }

        const converted = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                // Check if it's a URL (starts with http:// or https://)
                // Convert all URL-like strings, not just 'url' or 'location' fields
                if (value.startsWith('http://') || value.startsWith('https://')) {
                    converted[key] = convertS3ToCdn(value);
                } else {
                    converted[key] = value;
                }
            } else if (typeof value === 'object' && value !== null) {
                // Recursively process nested objects
                converted[key] = convertConfigUrlsToCdn(value);
            } else {
                converted[key] = value;
            }
        }
        return converted;
    };

    // Helper function to apply default configuration for full-page-ad poll elements
    // Supports both old structure (content.poll) and new structure (content.layers)
    const applyDefaultPollConfig = (config, elemType) => {
        if (elemType === 'full-page-ad' && config?.content?.type === 'poll') {
            const defaultHeroImage = {
                url: 'https://raw.githubusercontent.com/akash2705s/img2/main/pop.mp4',
                uploadedMedia: null
            };
            const defaultQrCode = {
                text: 'Save 15%',
                subtext: 'sitewide',
                branding: 'Code: 15CUPID',
                url: 'https://raw.githubusercontent.com/akash2705s/img2/main/pf1.png',
                uploadedMedia: null,
                duration: 20,
                qrDisplayDurationSeconds: 20
            };
            const defaultQrHeroImage = {
                url: 'https://raw.githubusercontent.com/akash2705s/img2/main/tpf.png',
                uploadedMedia: null
            };

            // Check if using layers structure (new format)
            const hasLayers = Array.isArray(config.content.layers);

            if (hasLayers) {
                // New structure: ensure defaults in layers
                const pollLayer = config.content.layers.find(layer => layer.type === 'poll');
                if (pollLayer && (!pollLayer.heroImage || !pollLayer.heroImage.url)) {
                    pollLayer.heroImage = defaultHeroImage;
                }

                const qrLayers = config.content.layers.filter(layer => layer.type === 'qr');
                if (qrLayers.length > 0) {
                    qrLayers.forEach(qrLayer => {
                        if (!qrLayer.heroImage || !qrLayer.heroImage.url) {
                            qrLayer.heroImage = defaultQrHeroImage;
                        }
                        if (!qrLayer.qrCode) {
                            qrLayer.qrCode = defaultQrCode;
                        } else {
                            if (!qrLayer.qrCode.text) qrLayer.qrCode.text = defaultQrCode.text;
                            if (!qrLayer.qrCode.subtext) qrLayer.qrCode.subtext = defaultQrCode.subtext;
                            if (!qrLayer.qrCode.branding) qrLayer.qrCode.branding = defaultQrCode.branding;
                            if (!qrLayer.qrCode.url) qrLayer.qrCode.url = defaultQrCode.url;
                            if (!qrLayer.qrCode.duration && qrLayer.qrCode.duration !== 0) {
                                qrLayer.qrCode.duration = defaultQrCode.duration;
                            }
                            if (!qrLayer.qrCode.qrDisplayDurationSeconds && qrLayer.qrCode.qrDisplayDurationSeconds !== 0) {
                                qrLayer.qrCode.qrDisplayDurationSeconds = defaultQrCode.qrDisplayDurationSeconds;
                            }
                        }
                    });
                }
            } else {
                // Old structure: apply defaults to content.poll
                if (!config.content.poll) {
                    config.content.poll = {};
                }

                if (!config.content.poll.heroImage || !config.content.poll.heroImage.url) {
                    config.content.poll.heroImage = defaultHeroImage;
                }

                if (!config.content.poll.qrBackgroundImage) {
                    config.content.poll.qrBackgroundImage = defaultQrHeroImage.url;
                }

                if (!config.content.poll.qrCode) {
                    config.content.poll.qrCode = defaultQrCode;
                } else {
                    if (!config.content.poll.qrCode.text) {
                        config.content.poll.qrCode.text = defaultQrCode.text;
                    }
                    if (!config.content.poll.qrCode.subtext) {
                        config.content.poll.qrCode.subtext = defaultQrCode.subtext;
                    }
                    if (!config.content.poll.qrCode.branding) {
                        config.content.poll.qrCode.branding = defaultQrCode.branding;
                    }
                    if (!config.content.poll.qrCode.url) {
                        config.content.poll.qrCode.url = defaultQrCode.url;
                    }
                    if (!config.content.poll.qrCode.duration && config.content.poll.qrCode.duration !== 0) {
                        config.content.poll.qrCode.duration = defaultQrCode.duration;
                    }
                    if (!config.content.poll.qrCode.qrDisplayDurationSeconds && config.content.poll.qrCode.qrDisplayDurationSeconds !== 0) {
                        config.content.poll.qrCode.qrDisplayDurationSeconds = defaultQrCode.qrDisplayDurationSeconds;
                    }
                }
            }
        }
        return config;
    };

    // 5. Add one <Ad> per running element (sequence = index + 1)
    elements.forEach((element, index) => {
        const envSet = platformsByElementId.get(String(element._id)) || new Set();
        const platforms = Array.from(envSet).filter(Boolean);
        const platform = platforms[0] || null;

        const ad = vast.ele("Ad", {
            id: element._id,
            sequence: index + 1,
        });

        const inLine = ad.ele("InLine");

        inLine.ele("AdSystem").txt("Canvas SSAI");
        inLine.ele("AdTitle").dat(element.meta?.title || "Untitled Ad");

        // Impression (enriched with campaign + timestamp placeholder)
        // Client will replace [sessionId] and [timestamp] if needed
        inLine.ele("Impression").dat(
            `${process.env.DOMAIN_NAME}/api/track/impression/${element._id}` +
            `?campaignId=${campaignId}` +
            `&sessionId=[sessionId]` +
            `&ts=[timestamp]`
        );

        // Add Error tracking (recommended by VAST spec)
        inLine.ele("Error").dat(
            `${process.env.DOMAIN_NAME}/api/track/error/${element._id}` +
            `?campaignId=${campaignId}&err=[ERRORCODE]` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        // Creative wrapper
        const creative = inLine.ele("Creatives").ele("Creative");

        // Dynamically choose Linear / NonLinear / Companion based on elementType
        const elemType = element.meta?.elementType || "corner-banner";

        // Apply default configuration for full-page-ad poll elements
        let elementConfig = element.configuration || {};
        elementConfig = applyDefaultPollConfig(JSON.parse(JSON.stringify(elementConfig)), elemType);

        // Convert all S3 URLs to CDN URLs in configuration
        elementConfig = convertConfigUrlsToCdn(elementConfig);

        let adContainer;

        if (["corner-banner", "l-banner", "full-page-ad"].includes(elemType)) {
            // NonLinear for overlays
            adContainer = creative.ele("NonLinearAds").ele("NonLinear", {
                width: elementConfig?.layout?.dimensions?.width || "1280",
                height: elementConfig?.layout?.dimensions?.height || "720",
                expandedWidth: "1280",
                expandedHeight: "720",
                apiFramework: "javascript",
                minSuggestedDuration: "00:00:15", // fallback
            });
        } else if (elemType.includes("video") || elemType === "linear-ad") {
            // Linear for video ads
            adContainer = creative.ele("Linear");
            // Add MediaFiles if video URL present
            if (elementConfig?.mainVideoUrl) {
                const mediaFiles = adContainer.ele("MediaFiles");
                mediaFiles.ele("MediaFile", {
                    delivery: "progressive",
                    type: "video/mp4",
                    width: "1280",
                    height: "720",
                }).dat(elementConfig.mainVideoUrl);
            }
        } else {
            // Fallback to NonLinear
            adContainer = creative.ele("NonLinearAds").ele("NonLinear");
        }

        // Embed full configuration as JSON in AdParameters (critical for client rendering, including styles, QR, behaviors)
        adContainer.ele("AdParameters").dat(
            JSON.stringify({
                elementId: element._id,
                campaignId: campaignId,
                platform,
                platforms,
                elementType: elemType,
                configuration: elementConfig,
                meta: element.meta || {},
                // Add campaign-level overrides if needed (e.g., global styles or behaviors)
            }, null, 2)
        );

        // Add fallback StaticResource (required for NonLinear if JS fails)
        if (adContainer.name === "NonLinear") {
            // Try to get heroImage from layers structure (new) or poll structure (old)
            let heroImageUrl = null;
            if (Array.isArray(elementConfig?.content?.layers)) {
                const pollLayer = elementConfig.content.layers.find(layer => layer.type === 'poll');
                heroImageUrl = pollLayer?.heroImage?.url;
            }
            if (!heroImageUrl) {
                heroImageUrl = elementConfig?.content?.poll?.heroImage?.url || elementConfig?.content?.heroImage?.url;
            }
            // Ensure heroImageUrl is converted to CDN (should already be converted, but double-check)
            heroImageUrl = heroImageUrl ? convertS3ToCdn(heroImageUrl) : null;
            // Use CDN URL for fallback
            const fallbackUrl = "https://images.ads.canvas.space/fallback/default-poster.png";
            adContainer.ele("StaticResource", { creativeType: "image/png" }).dat(
                heroImageUrl || fallbackUrl
            );
        }

        // TrackingEvents - comprehensive coverage including QR-specific and dismiss
        const trackingEvents = adContainer.ele("TrackingEvents");

        // Standard events
        trackingEvents.ele("Tracking", { event: "impression" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/impression/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "creativeView" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/creativeView/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "click" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/click/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&value=[selectedValue]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "complete" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/complete/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "close" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/close/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        // QR-specific events
        trackingEvents.ele("Tracking", { event: "qrShown" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/qrShown/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "qrClosed" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/qrClosed/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "qrOpened" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/qrOpened/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        // Optional: add viewable, firstQuartile, midpoint, thirdQuartile if video-based

        // Dynamic Display timing - pulled from element config dynamically
        const display = adContainer.ele("Display");
        const cfg = element.configuration || {};
        // Handle different config paths (from your samples)
        let startOffset = cfg.display?.startOffset || cfg.vast?.display?.timeTriggers?.[0]?.triggerTime || "00:00:05";
        let endOffset = cfg.display?.endOffset || (cfg.vast?.display?.timeTriggers?.[0]?.triggerTime + `:${cfg.vast?.display?.timeTriggers?.[0]?.duration}`) || "00:00:20";
        display.ele("StartOffset").txt(startOffset);
        display.ele("EndOffset").txt(endOffset);

        // QR display duration (for corner-banner / layered creatives)
        // Look for a QR layer in the new layers structure and surface its duration into VAST
        try {
            let qrDisplayDurationSeconds = null;

            // New structure: configuration.content.layers[*].qrCode.{duration, qrDisplayDurationSeconds}
            if (Array.isArray(cfg.content?.layers)) {
                const qrLayer = cfg.content.layers.find(l => l && l.type === 'qr' && l.qrCode);
                if (qrLayer && qrLayer.qrCode) {
                    const qrCfg = qrLayer.qrCode;
                    if (typeof qrCfg.qrDisplayDurationSeconds === 'number') {
                        qrDisplayDurationSeconds = qrCfg.qrDisplayDurationSeconds;
                    } else if (qrCfg.qrDisplayDurationSeconds != null && !Number.isNaN(Number(qrCfg.qrDisplayDurationSeconds))) {
                        qrDisplayDurationSeconds = Number(qrCfg.qrDisplayDurationSeconds);
                    } else if (typeof qrCfg.duration === 'number') {
                        qrDisplayDurationSeconds = qrCfg.duration;
                    } else if (qrCfg.duration != null && !Number.isNaN(Number(qrCfg.duration))) {
                        qrDisplayDurationSeconds = Number(qrCfg.duration);
                    }
                }
            }

            // Legacy structure (if any): configuration.content.poll.qrCode / configuration.content.poll.qrDisplayDurationSeconds
            if (qrDisplayDurationSeconds == null && cfg.content?.poll) {
                const poll = cfg.content.poll;
                if (typeof poll.qrDisplayDurationSeconds === 'number') {
                    qrDisplayDurationSeconds = poll.qrDisplayDurationSeconds;
                } else if (poll.qrDisplayDurationSeconds != null && !Number.isNaN(Number(poll.qrDisplayDurationSeconds))) {
                    qrDisplayDurationSeconds = Number(poll.qrDisplayDurationSeconds);
                }
            }

            if (qrDisplayDurationSeconds != null && Number.isFinite(qrDisplayDurationSeconds) && qrDisplayDurationSeconds > 0) {
                display.ele("QRDisplayDurationSeconds").txt(String(qrDisplayDurationSeconds));
            }
        } catch (qrErr) {
            console.warn(`[VAST] Failed to derive QR display duration for element ${element._id}:`, qrErr.message);
        }

        // If multiple timeTriggers (e.g., in full-page-ad), add as extension
        if (cfg.vast?.display?.timeTriggers && cfg.vast?.display?.timeTriggers.length > 1) {
            const extensions = inLine.ele("Extensions").ele("Extension", { type: "canvas:timeTriggers" });
            extensions.ele("TimeTriggers").dat(JSON.stringify(cfg.vast.display.timeTriggers));
        }

        // Optional: CompanionAds for web fallback
        if (cfg.behavior?.showBannersOnPause || true) { // adjust condition
            const companionAds = creative.ele("CompanionAds");
            const companionImageUrl = cfg.content?.heroImage?.url ? convertS3ToCdn(cfg.content.heroImage.url) : "fallback-banner.png";
            companionAds.ele("Companion", { width: "300", height: "250" })
                .ele("StaticResource", { creativeType: "image/png" }).dat(companionImageUrl);
        }
    });

    // Finalize XML
    const xmlString = vast.end({ pretty: true });

    // 6. Save to S3 (cache like brand vast) only for full-campaign generation
    const s3Key = `vast/campaign/${campaignId}.xml`;

    let saved = false;
    if (!includeAdUnits || includeAdUnits.length === 0) {
        await uploadToS3(s3Key, xmlString);
        saved = true;
    }

    return {
        xml: xmlString,
        s3Key,
        saved,
        adCount: elements.length,
        campaignName: campaign.name,
    };
};

// Export for use in campaignActions when ad units are added/updated
exports.generateCombinedCampaignVast = generateCombinedCampaignVast;



/**
 * Generates a combined VAST XML for a campaign (only running ad units)
 * Saves to S3 under vast/campaign/{campaignId}.xml
 * Returns { xml: string, s3Key: string, saved: boolean }
 * campaingId
 */
async function generateCombinedBrandVasts(brandId, options = {}) {

    const { tvPlatforms = [] } = options;

    // 1. Fetch brand and verify
    const brand = await Brand.findById(brandId);
    if (!brand) {
        throw new Error(`brand not found: ${brand}`);
    }

    const campaigns = await Campaign.find(
        {
            brandId,
            status: 'active',
            'adUnits.status': 'running'
        },
        { adUnits: 1 }
    );

    console.log(`[Brand VAST] Found ${campaigns.length} active campaigns with running ad units for brand ${brandId}`);

    const runningElementIds = new Set();
    // elementId -> Set(environments) so we can inject platform into VAST
    const environmentsByElementId = new Map();

    const tvFilterSet = tvPlatforms.length
        ? new Set(tvPlatforms.map(v => String(v).toLowerCase()))
        : null;

    campaigns.forEach(campaign => {
        console.log(`[Brand VAST] Campaign ${campaign._id} has ${campaign.adUnits.length} ad units`);
        campaign.adUnits.forEach(unit => {
            if (unit.status === 'running') {
                // Optional OEM filter: unit.environment must match requested platform(s)
                if (tvFilterSet) {
                    const unitPlatform = canonicalizePlatform(unit.environment);
                    const env = String(unitPlatform || '').toLowerCase();
                    if (!tvFilterSet.has(env)) return;
                }

                runningElementIds.add(unit.elementId);
                console.log(`[Brand VAST] Added element ${unit.elementId} from campaign ${campaign._id}`);

                const key = String(unit.elementId);
                if (!environmentsByElementId.has(key)) environmentsByElementId.set(key, new Set());
                environmentsByElementId.get(key).add(canonicalizePlatform(unit.environment) || unit.environment);
            }
        });
    });

    console.log(`[Brand VAST] Total running element IDs: ${runningElementIds.size}`);
    console.log(`[Brand VAST] Running element IDs:`, Array.from(runningElementIds));

    // Helper to build an empty VAST document for brand-level requests
    const buildEmptyBrandVast = () => {
        const emptyVast = xmlbuilder.begin()
            .dec({ version: "1.0", encoding: "UTF-8" })
            .ele("VAST")
            .att("version", "4.1")
            .att("xmlns", "http://www.iab.com/VAST")
            .att("xmlns:xs", "http://www.w3.org/2001/XMLSchema")
            .att("xmlns:canvas", "http://canvas-siau.com/extensions");

        return emptyVast.end({ pretty: true });
    };

    const elements = await Element.find({
        brandId,
        _id: { $in: Array.from(runningElementIds) }
    });

    console.log(`[Brand VAST] Found ${elements.length} elements matching running ad units`);
    elements.forEach(elem => {
        console.log(`[Brand VAST] Element: ${elem._id} (${elem.meta?.elementType || 'unknown'}) - ${elem.meta?.title || 'Untitled'}`);
    });

    if (elements.length === 0) {
        // No matching elements for any running ad units -> return an empty VAST instead of throwing
        console.log(`[Brand VAST] No matching elements found for running ad units – returning empty VAST for brand ${brandId}.`);
        const xmlString = buildEmptyBrandVast();
        const s3Key = `vast/brand/${brandId}.xml`;

        return {
            xml: xmlString,
            s3Key,
            saved: false,
            adCount: 0,
        };
    }

    // 4. Build VAST root with correct XML declaration and VAST version
    const vast = xmlbuilder.begin()
        .dec({ version: "1.0", encoding: "UTF-8" })
        .ele("VAST")
        .att("version", "4.1")
        .att("xmlns", "http://www.iab.com/VAST")
        .att("xmlns:xs", "http://www.w3.org/2001/XMLSchema");

    // Add custom extensions namespace if needed (e.g., for LG-specific or QR hints)
    vast.att("xmlns:canvas", "http://canvas-siau.com/extensions");

    // Helper function to convert S3 URL to CDN URL
    const convertS3ToCdn = (url) => {
        if (!url || typeof url !== 'string') return url;

        // Skip if already CDN URL
        if (url.includes('images.ads.canvas.space')) return url;

        // Check if it's an S3 URL (cis-v1.s3.us-east-2.amazonaws.com or similar)
        const s3Pattern = /https?:\/\/([^\/]+)\.s3\.([^\/]+)\.amazonaws\.com\/([^?]+)/;
        const match = url.match(s3Pattern);

        if (match) {
            const s3Key = match[3];
            return `https://images.ads.canvas.space/${s3Key}`;
        }

        const s3AltPattern = /https?:\/\/s3\.([^\/]+)\.amazonaws\.com\/([^\/]+)\/([^?]+)/;
        const altMatch = url.match(s3AltPattern);
        if (altMatch) {
            const key = altMatch[3];
            return `https://images.ads.canvas.space/${key}`;
        }

        return url;
    };

    // Helper function to recursively convert S3 URLs to CDN URLs in configuration
    const convertConfigUrlsToCdn = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;

        if (Array.isArray(obj)) {
            return obj.map(item => convertConfigUrlsToCdn(item));
        }

        const converted = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                if (value.startsWith('http://') || value.startsWith('https://')) {
                    converted[key] = convertS3ToCdn(value);
                } else {
                    converted[key] = value;
                }
            } else if (typeof value === 'object' && value !== null) {
                converted[key] = convertConfigUrlsToCdn(value);
            } else {
                converted[key] = value;
            }
        }
        return converted;
    };

    // Helper function to apply default configuration for full-page-ad poll elements
    const applyDefaultPollConfig = (config, elemType) => {
        if (elemType === 'full-page-ad' && config?.content?.type === 'poll') {
            const defaultHeroImage = {
                url: 'https://raw.githubusercontent.com/akash2705s/img2/main/pop.mp4',
                uploadedMedia: null
            };
            const defaultQrCode = {
                text: 'Save 15%',
                subtext: 'sitewide',
                branding: 'Code: 15CUPID',
                url: 'https://raw.githubusercontent.com/akash2705s/img2/main/pf1.png',
                uploadedMedia: null,
                duration: 20,
                qrDisplayDurationSeconds: 20
            };
            const defaultQrHeroImage = {
                url: 'https://raw.githubusercontent.com/akash2705s/img2/main/tpf.png',
                uploadedMedia: null
            };

            const hasLayers = Array.isArray(config.content.layers);

            if (hasLayers) {
                const pollLayer = config.content.layers.find(layer => layer.type === 'poll');
                if (pollLayer && (!pollLayer.heroImage || !pollLayer.heroImage.url)) {
                    pollLayer.heroImage = defaultHeroImage;
                }

                const qrLayers = config.content.layers.filter(layer => layer.type === 'qr');
                if (qrLayers.length > 0) {
                    qrLayers.forEach(qrLayer => {
                        if (!qrLayer.heroImage || !qrLayer.heroImage.url) {
                            qrLayer.heroImage = defaultQrHeroImage;
                        }
                        if (!qrLayer.qrCode) {
                            qrLayer.qrCode = defaultQrCode;
                        } else {
                            if (!qrLayer.qrCode.text) qrLayer.qrCode.text = defaultQrCode.text;
                            if (!qrLayer.qrCode.subtext) qrLayer.qrCode.subtext = defaultQrCode.subtext;
                            if (!qrLayer.qrCode.branding) qrLayer.qrCode.branding = defaultQrCode.branding;
                            if (!qrLayer.qrCode.url) qrLayer.qrCode.url = defaultQrCode.url;
                            if (!qrLayer.qrCode.duration && qrLayer.qrCode.duration !== 0) {
                                qrLayer.qrCode.duration = defaultQrCode.duration;
                            }
                            if (!qrLayer.qrCode.qrDisplayDurationSeconds && qrLayer.qrCode.qrDisplayDurationSeconds !== 0) {
                                qrLayer.qrCode.qrDisplayDurationSeconds = defaultQrCode.qrDisplayDurationSeconds;
                            }
                        }
                    });
                }
            } else {
                if (!config.content.poll) {
                    config.content.poll = {};
                }

                if (!config.content.poll.heroImage || !config.content.poll.heroImage.url) {
                    config.content.poll.heroImage = defaultHeroImage;
                }

                if (!config.content.poll.qrBackgroundImage) {
                    config.content.poll.qrBackgroundImage = defaultQrHeroImage.url;
                }

                if (!config.content.poll.qrCode) {
                    config.content.poll.qrCode = defaultQrCode;
                } else {
                    if (!config.content.poll.qrCode.text) {
                        config.content.poll.qrCode.text = defaultQrCode.text;
                    }
                    if (!config.content.poll.qrCode.subtext) {
                        config.content.poll.qrCode.subtext = defaultQrCode.subtext;
                    }
                    if (!config.content.poll.qrCode.branding) {
                        config.content.poll.qrCode.branding = defaultQrCode.branding;
                    }
                    if (!config.content.poll.qrCode.url) {
                        config.content.poll.qrCode.url = defaultQrCode.url;
                    }
                    if (!config.content.poll.qrCode.duration && config.content.poll.qrCode.duration !== 0) {
                        config.content.poll.qrCode.duration = defaultQrCode.duration;
                    }
                    if (!config.content.poll.qrCode.qrDisplayDurationSeconds && config.content.poll.qrCode.qrDisplayDurationSeconds !== 0) {
                        config.content.poll.qrCode.qrDisplayDurationSeconds = defaultQrCode.qrDisplayDurationSeconds;
                    }
                }
            }
        }
        return config;
    };

    const campaignMap = new Map();
    campaigns.forEach(campaign => {
        campaign.adUnits.forEach(unit => {
            if (!campaignMap.has(unit.elementId)) {
                campaignMap.set(unit.elementId, []);
            }
            campaignMap.get(unit.elementId).push(campaign._id);
        });
    });


    // 5. Add one <Ad> per running element (sequence = index + 1)
    elements.forEach((element, index) => {
        const envSet = environmentsByElementId.get(String(element._id)) || new Set();
        const platforms = Array.from(envSet).filter(Boolean);
        const platform = platforms[0] || null;

        const ad = vast.ele("Ad", {
            id: element._id,
            sequence: index + 1,
        });
        const campaignId =
            campaignMap.get(element._id) || [];
        const inLine = ad.ele("InLine");

        inLine.ele("AdSystem").txt("Canvas SSAI");
        inLine.ele("AdTitle").dat(element.meta?.title || "Untitled Ad");

        // Impression (enriched with campaign + timestamp placeholder)
        // Client will replace [sessionId] and [timestamp] if needed
        inLine.ele("Impression").dat(
            `${process.env.DOMAIN_NAME}/api/track/impression/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]` +
            `&ts=[timestamp]`
        );

        // Add Error tracking (recommended by VAST spec)
        inLine.ele("Error").dat(
            `${process.env.DOMAIN_NAME}/api/track/error/${element._id}` +
            `?campaignId=${campaignId}&err=[ERRORCODE]` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        // Creative wrapper
        const creative = inLine.ele("Creatives").ele("Creative");

        // Dynamically choose Linear / NonLinear / Companion based on elementType
        const elemType = element.meta?.elementType || "corner-banner";

        // Apply default configuration for full-page-ad poll elements
        let elementConfig = element.configuration || {};
        elementConfig = applyDefaultPollConfig(JSON.parse(JSON.stringify(elementConfig)), elemType);

        // Convert all S3 URLs to CDN URLs in configuration
        elementConfig = convertConfigUrlsToCdn(elementConfig);

        let adContainer;

        if (["corner-banner", "l-banner", "full-page-ad"].includes(elemType)) {
            // NonLinear for overlays
            adContainer = creative.ele("NonLinearAds").ele("NonLinear", {
                width: elementConfig?.layout?.dimensions?.width || "1280",
                height: elementConfig?.layout?.dimensions?.height || "720",
                expandedWidth: "1280",
                expandedHeight: "720",
                apiFramework: "javascript",
                minSuggestedDuration: "00:00:15", // fallback
            });
        } else if (elemType.includes("video") || elemType === "linear-ad") {
            // Linear for video ads
            adContainer = creative.ele("Linear");
            // Add MediaFiles if video URL present
            if (elementConfig?.mainVideoUrl) {
                const mediaFiles = adContainer.ele("MediaFiles");
                mediaFiles.ele("MediaFile", {
                    delivery: "progressive",
                    type: "video/mp4",
                    width: "1280",
                    height: "720",
                }).dat(elementConfig.mainVideoUrl);
            }
        } else {
            // Fallback to NonLinear
            adContainer = creative.ele("NonLinearAds").ele("NonLinear");
        }

        // Embed full configuration as JSON in AdParameters (critical for client rendering, including styles, QR, behaviors)
        adContainer.ele("AdParameters").dat(
            JSON.stringify({
                elementId: element._id,
                campaignId: campaignId,
                platform,
                platforms,
                elementType: elemType,
                configuration: elementConfig,
                meta: element.meta || {},
                // Add campaign-level overrides if needed (e.g., global styles or behaviors)
            }, null, 2)
        );

        // Add fallback StaticResource (required for NonLinear if JS fails)
        if (adContainer.name === "NonLinear") {
            // Try to get heroImage from layers structure (new) or poll structure (old)
            let heroImageUrl = null;
            if (Array.isArray(elementConfig?.content?.layers)) {
                const pollLayer = elementConfig.content.layers.find(layer => layer.type === 'poll');
                heroImageUrl = pollLayer?.heroImage?.url;
            }
            if (!heroImageUrl) {
                heroImageUrl = elementConfig?.content?.poll?.heroImage?.url || elementConfig?.content?.heroImage?.url;
            }
            // Ensure heroImageUrl is converted to CDN (should already be converted, but double-check)
            heroImageUrl = heroImageUrl ? convertS3ToCdn(heroImageUrl) : null;
            // Use CDN URL for fallback
            const fallbackUrl = "https://images.ads.canvas.space/fallback/default-poster.png";
            adContainer.ele("StaticResource", { creativeType: "image/png" }).dat(
                heroImageUrl || fallbackUrl
            );
        }

        // TrackingEvents - comprehensive coverage including QR-specific and dismiss
        const trackingEvents = adContainer.ele("TrackingEvents");

        // Standard events
        trackingEvents.ele("Tracking", { event: "impression" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/impression/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "creativeView" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/creativeView/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "click" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/click/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&value=[selectedValue]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "complete" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/complete/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "close" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/close/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        // QR-specific events
        trackingEvents.ele("Tracking", { event: "qrShown" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/qrShown/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "qrClosed" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/qrClosed/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "qrOpened" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/qrOpened/${element._id}` +
            `?campaignId=${campaignId}` +
            `${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` +
            `&sessionId=[sessionId]&ts=[timestamp]`
        );

        // Optional: add viewable, firstQuartile, midpoint, thirdQuartile if video-based

        // Dynamic Display timing - pulled from element config dynamically
        const display = adContainer.ele("Display");
        // Handle different config paths (from your samples)
        let startOffset = elementConfig.display?.startOffset || elementConfig.vast?.display?.timeTriggers?.[0]?.triggerTime || "00:00:05";
        let endOffset = elementConfig.display?.endOffset || (elementConfig.vast?.display?.timeTriggers?.[0]?.triggerTime + `:${elementConfig.vast?.display?.timeTriggers?.[0]?.duration}`) || "00:00:20";
        display.ele("StartOffset").txt(startOffset);
        display.ele("EndOffset").txt(endOffset);

        // QR display duration (for corner-banner / layered creatives on brand VAST)
        // Same logic as campaign VAST: surface QR layer duration into XML for downstream players
        try {
            let qrDisplayDurationSeconds = null;

            if (Array.isArray(elementConfig.content?.layers)) {
                const qrLayer = elementConfig.content.layers.find(l => l && l.type === 'qr' && l.qrCode);
                if (qrLayer && qrLayer.qrCode) {
                    const qrCfg = qrLayer.qrCode;
                    if (typeof qrCfg.qrDisplayDurationSeconds === 'number') {
                        qrDisplayDurationSeconds = qrCfg.qrDisplayDurationSeconds;
                    } else if (qrCfg.qrDisplayDurationSeconds != null && !Number.isNaN(Number(qrCfg.qrDisplayDurationSeconds))) {
                        qrDisplayDurationSeconds = Number(qrCfg.qrDisplayDurationSeconds);
                    } else if (typeof qrCfg.duration === 'number') {
                        qrDisplayDurationSeconds = qrCfg.duration;
                    } else if (qrCfg.duration != null && !Number.isNaN(Number(qrCfg.duration))) {
                        qrDisplayDurationSeconds = Number(qrCfg.duration);
                    }
                }
            }

            if (qrDisplayDurationSeconds != null && Number.isFinite(qrDisplayDurationSeconds) && qrDisplayDurationSeconds > 0) {
                display.ele("QRDisplayDurationSeconds").txt(String(qrDisplayDurationSeconds));
            }
        } catch (qrErr) {
            console.warn(`[VAST-Brand] Failed to derive QR display duration for element ${element._id}:`, qrErr.message);
        }

        // If multiple timeTriggers (e.g., in full-page-ad), add as extension
        if (elementConfig.vast?.display?.timeTriggers && elementConfig.vast?.display?.timeTriggers.length > 1) {
            const extensions = inLine.ele("Extensions").ele("Extension", { type: "canvas:timeTriggers" });
            extensions.ele("TimeTriggers").dat(JSON.stringify(elementConfig.vast.display.timeTriggers));
        }

        // Optional: CompanionAds for web fallback (pause/play functionality)
        if (elementConfig.behavior?.showBannersOnPause || true) { // adjust condition
            const companionAds = creative.ele("CompanionAds");
            const companionImageUrl = elementConfig.content?.heroImage?.url ? convertS3ToCdn(elementConfig.content.heroImage.url) : "fallback-banner.png";
            companionAds.ele("Companion", { width: "300", height: "250" })
                .ele("StaticResource", { creativeType: "image/png" }).dat(companionImageUrl);
        }
    });

    // Finalize XML
    const xmlString = vast.end({ pretty: true });

    // 6. Save to S3 (cache like brand vast)
    const s3Key = `vast/brands/${brandId}.xml`;

    await uploadToS3(s3Key, xmlString);

    return {
        xml: xmlString,
        s3Key,
        saved: true,
        adCount: elements.length,
    };
};

// Export for use in brand VAST generation
exports.generateCombinedBrandVasts = generateCombinedBrandVasts;

/**
 * Generates a combined VAST XML for a campaign (only running ad units)
 * Saves to S3 under vast/campaign/{campaignId}.xml
 * Returns { xml: string, s3Key: string, saved: boolean }
 */
async function generateCombinedCampaignVast_old(campaignId) {

    // 1. Fetch campaign and verify
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
        throw new Error(`Campaign not found: ${campaignId}`);
    }

    // 2. Filter only running ad units
    const runningAdUnits = campaign.adUnits.filter(
        (unit) => unit.status === "running"
    );

    if (runningAdUnits.length === 0) {
        throw new Error("No running ad units in this campaign");
    }

    // 3. Fetch full elements (Element docs)
    const elementIds = runningAdUnits.map((u) => u.elementId);
    const elements = await Element.find({
        _id: { $in: elementIds },
    }).lean(); // lean for performance

    if (elements.length === 0) {
        // For campaign-level combined VAST (used by tools / admin), keep throwing;
        // callers of generateCombinedCampaignVast already map this to a 500/JSON response.
        throw new Error("No matching elements found for running ad units");
    }

    // 4. Build VAST root
    // const vast = xmlbuilder.create("VAST", { version: "4.1" })
    //     .att("xmlns", "http://www.iab.com/VAST")
    //     .att("xmlns:xs", "http://www.w3.org/2001/XMLSchema");

    // Build complete VAST XML structure
    const vast = xmlbuilder.create("VAST", { version: "1.0", encoding: "UTF-8" })
        .att("version", "4.1");

    // Optional: add custom namespace if needed for LG/Web extensions
    // vast.att("xmlns:lg", "http://example.com/lg-extensions");

    // 5. Add one <Ad> per running element (sequence = index + 1)
    elements.forEach((element, index) => {
        const ad = vast.ele("Ad", {
            id: element._id,
            sequence: index + 1,
        });

        const inLine = ad.ele("InLine");

        inLine.ele("AdSystem").txt("Canvas SSAI");
        inLine.ele("AdTitle").dat(element.meta?.title || "Untitled Ad");

        // Impression (enriched with campaign + timestamp placeholder)
        // Client will replace [sessionId] and [timestamp] if needed
        inLine.ele("Impression").dat(
            `${process.env.DOMAIN_NAME}/api/track/impression/${element._id}` +
            `?campaignId=${campaignId}` +
            `&sessionId=[sessionId]` +
            `&ts=[timestamp]`
        );

        // Creative wrapper
        const creative = inLine.ele("Creatives").ele("Creative");

        // Use Linear / NonLinear / Companion based on elementType
        // For now assuming mostly NonLinear (overlay) for LG/Web
        const nonLinearAds = creative.ele("NonLinearAds");

        // Main NonLinear block
        const nonLinear = nonLinearAds.ele("NonLinear", {
            width: "1280",   // typical LG/Web resolution placeholder
            height: "720",
            expandedWidth: "1280",
            expandedHeight: "720",
            apiFramework: "javascript", // since nomin.js is JS renderer
            minSuggestedDuration: "00:00:15", // fallback
        });

        // Embed full configuration as JSON in AdParameters (critical for client)
        nonLinear.ele("AdParameters").dat(
            JSON.stringify({
                elementId: element._id,
                campaignId: campaignId,
                elementType: element.meta?.elementType || "unknown",
                configuration: element.configuration || {},
                // Add any campaign-level overrides if needed later
            }, null, 2)
        );

        // TrackingEvents - per element + enriched
        const trackingEvents = nonLinear.ele("TrackingEvents");

        // Example events - client nomin.js will call these with real values
        trackingEvents.ele("Tracking", { event: "impression" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/impression/${element._id}` +
            `?campaignId=${campaignId}&sessionId=[sessionId]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "click" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/click/${element._id}` +
            `?campaignId=${campaignId}&sessionId=[sessionId]&value=[selectedValue]&ts=[timestamp]`
        );

        trackingEvents.ele("Tracking", { event: "creativeView" }).dat(
            `${process.env.DOMAIN_NAME}/api/track/creativeView/${element._id}` +
            `?campaignId=${campaignId}&sessionId=[sessionId]&ts=[timestamp]`
        );

        // Optional: add more like start, complete, etc. if video/linear

        // Display timing - pulled from element config if present, else fallback
        const display = nonLinear.ele("Display");
        const cfg = element.configuration || {};
        display.ele("StartOffset").txt(cfg.display?.startOffset || "00:00:05");
        display.ele("EndOffset").txt(cfg.display?.endOffset || "00:00:20");

        // Optional: add companion/banner if needed for web fallback
    });

    // Finalize XML
    const xmlString = vast.end({ pretty: true, xmldec: { version: "1.0", encoding: "UTF-8" } });

    // 6. Save to S3 (cache like brand vast)
    const s3Key = `vast/campaign/${campaignId}.xml`;

    await uploadToS3(s3Key, xmlString);

    return {
        xml: xmlString,
        s3Key,
        saved: true,
        adCount: elements.length,
        campaignName: campaign.name,
    };
};

exports.generateAllBrandVast = async (req, res) => {

    try {
        const userObjectId = new mongoose.Types.ObjectId(req.user.id);
        //const brandObjectId = new mongoose.Types.ObjectId(req.params.brandId);
        const brandIdStr = String(req.params.brandId);
        const elements = await Element.find({
            userId: userObjectId,
            brandId: String(req.params.brandId)
        });

        if (!elements.length)
            return res.status(404).json({ error: "No elements found for this brand" });

        const result = await generateCombinedBrandVasts(brandIdStr);  // ← pass string only

        res.json({
            success: true,
            s3Key: result.s3Key,
            adCount: result.adCount || 0,
            message: "VAST generated and saved to S3"
        });
    } catch (err) {
        console.error("VAST generate error:", err);
        if (err.name === 'CastError') {
            return res.status(400).json({ error: "Invalid campaign ID - casting failed" });
        }
        res.status(500).json({ error: err.message || "Failed to generate VAST" });
    }
}
exports.generateAllBrandVast_old = async (req, res) => {
    try {
        const userObjectId = new mongoose.Types.ObjectId(req.user.id);
        const brandObjectId = new mongoose.Types.ObjectId(req.params.brandId);

        const elements = await Element.find({
            userId: userObjectId,
            brandId: String(brandObjectId)
        });

        if (!elements.length)
            return res.status(404).json({ error: "No elements found for this brand" });

        let results = [];
        let successCount = 0;
        let errorCount = 0;

        for (const elem of elements) {
            try {
                const elementId = elem.meta?.id || elem._id.toString();

                // Generate VAST XML using the shared generation function
                // This ensures the same XML structure as individual element VAST
                const xml = await vastActions.generateVastXmlString(elem);

                // Store in S3 using standard key format: vast/${elementId}.xml
                const s3Key = `vast/${elementId}.xml`;
                await uploadToS3(s3Key, xml);

                results.push({
                    elementId: elementId,
                    s3Key,
                    url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`
                });
                successCount++;
            } catch (error) {
                console.error(`Error generating VAST for element ${elem.meta?.id || elem._id}:`, error);
                errorCount++;
            }
        }

        return res.json({
            message: "VAST XML generated & cached on S3",
            count: results.length,
            successCount,
            errorCount,
            files: results
        });

    } catch (error) {
        console.error("Brand VAST Generate Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};


// 🟦 2) Get Random & Unique VAST
exports.getRandomBrandVast_old = async (req, res) => {
    try {
        // Log client IP and geolocation details for VAST tag requests
        const geoData = await getIPAndGeo(req);
        const userAgent = req.get("User-Agent") || req.headers["user-agent"] || "unknown";
        const timestamp = Date.now();
        const brandId = req.params.brandId;
        const path = req.originalUrl || req.url;

        // Warn if geolocation data is missing
        if (!geoData.city && !geoData.country) {
            console.warn(`[VAST Request] Missing geolocation data for IP ${geoData.ip} - API lookup likely failed`);
        }

        // Prepare log data
        const vastRequestLog = {
            vastBrandId: brandId,
            ip: geoData.ip,
            userAgent: userAgent,
            timestamp: timestamp,
            path: path,
            location: {
                city: geoData.city,
                region: geoData.region,
                country: geoData.country,
                country_name: geoData.country_name,
                latitude: geoData.latitude,
                longitude: geoData.longitude,
                timezone: geoData.timezone,
                isp: geoData.isp,
                org: geoData.org
            }
        };

        console.log("[VAST Request] IP logged:", JSON.stringify(vastRequestLog));

        // Save to database (non-blocking - don't await to avoid slowing down VAST response)
        VastRequestLog.create({
            vastBrandId: brandId,
            ip: geoData.ip,
            userAgent: userAgent,
            path: path,
            city: geoData.city,
            region: geoData.region,
            country: geoData.country,
            country_name: geoData.country_name,
            latitude: geoData.latitude,
            longitude: geoData.longitude,
            timezone: geoData.timezone,
            isp: geoData.isp,
            org: geoData.org,
            timestamp: new Date(timestamp)
        }).catch(err => {
            console.error("[VAST Request] Failed to save log to database:", err);
        });

        const seen = req.query.seen ? req.query.seen.split(",") : []; // elementIds array
        // Accept both `forceGenerate` and `forcegenerate` (and any casing), treat "true"/"True"/true as true
        const rawForce =
            req.query.forceGenerate ??
            req.query.forcegenerate ??
            req.query.ForceGenerate ??
            req.query.FORCEGENERATE;
        const forceGenerate =
            typeof rawForce === "string"
                ? rawForce.toLowerCase() === "true"
                : !!rawForce;

        const allElements = await Element.find({
            brandId: brandId
        });

        if (!allElements.length)
            return res.status(404).json({ error: "No elements found for brand" });

        // Filter only active/live elements if meta has status
        const activeElements = allElements.filter(el => {
            const status = el.meta?.status || el.status;
            if (!status) return true;
            return ['live', 'running', 'enabled'].includes(String(status).toLowerCase());
        });
        let pool = activeElements.length ? activeElements : allElements;

        // Prefer elements that look "valid" for their type
        // - L-Banner: must have segments + media
        // - Corner Banner / Full Page: accept as long as configuration exists (VAST generator will validate)
        const validPool = pool.filter(el => {
            const type = String(el.meta?.elementType || el.elementType || '').toLowerCase();

            // Corner banner & full-page-ad: rely on VAST generator; don't over-filter here
            if (type === 'corner-banner' || type === 'full-page-ad') {
                return !!el.configuration;
            }

            // Default / L-Banner validation (original logic)
            const segments = el.configuration?.layout?.segments;
            if (!Array.isArray(segments) || segments.length === 0) return false;
            const content = el.configuration?.content?.elements;
            if (content && Array.isArray(content) && content.length === 0) return false;
            const mediaPresent = segments.some((_, idx) => {
                const contentEntry = Array.isArray(content) ? content[idx] : content?.[idx];
                return contentEntry?.media?.url;
            });
            return mediaPresent;
        });

        if (validPool.length) {
            pool = validPool;
        }

        // Always generate combined VAST for brand (combines all elements)
        // Cache is checked but we always generate to ensure it's up-to-date
        const brandVastKey = `vast/brand_${brandId}.xml`;

        // Check cache first (for logging), but always generate fresh
        if (!forceGenerate) {
            try {
                const brandCached = await getFromS3(brandVastKey);
                if (brandCached && brandCached.trim().length > 0 && brandCached.includes('<Ad')) {
                    console.log(`[VAST] Found existing cache for brand ${brandId}, but generating fresh...`);
                } else {
                    console.log(`[VAST] No valid cache found for brand ${brandId}, generating...`);
                }
            } catch (err) {
                console.log(`[VAST] No cache found for brand ${brandId} (${err.message}), generating...`);
            }
        } else {
            console.log(`🔄 Force regenerating combined brand VAST for brand ${brandId}`);
        }

        // Always generate combined VAST (ensures it's always up-to-date with all elements)
        console.log(`[VAST] Generating combined VAST for brand ${brandId}...`);

        // Generate combined VAST with all elements for the brand
        // Use all active elements (not just one random)
        const allActiveElements = pool.filter(el => {
            const status = el.meta?.status || el.status;
            if (!status) return true;
            return ['live', 'running', 'enabled'].includes(String(status).toLowerCase());
        });

        if (allActiveElements.length === 0) {
            return res.status(404).json({ error: "No active elements found for brand" });
        }

        console.log(`[VAST] Generating combined VAST for ${allActiveElements.length} elements`);

        // Collect all Ad XML strings
        const adXmlStrings = [];

        // Generate VAST for each element and extract Ad elements
        for (const element of allActiveElements) {
            try {
                const elementId = element.meta?.id || element._id;
                const elementVastXml = await vastActions.generateVastXmlString(element);

                // Parse the generated VAST to extract Ad element using regex
                // Remove XML declaration and any content before <VAST>
                let cleanVast = elementVastXml.replace(/<\?xml[^>]*\?>/gi, '').trim();
                cleanVast = cleanVast.replace(/^[^\<]*/, '').trim();

                // Extract Ad element using regex (match entire Ad tag with all content)
                // Use non-greedy match to get complete Ad elements
                const adMatch = cleanVast.match(/<Ad[^>]*>[\s\S]*?<\/Ad>/i);
                if (adMatch) {
                    // Clean the extracted Ad XML - remove any XML declarations that might be inside
                    let adXml = adMatch[0];
                    adXml = adXml.replace(/<\?xml[^>]*\?>/gi, '').trim();
                    adXmlStrings.push(adXml);
                    console.log(`[VAST] Extracted Ad element for ${elementId}`);
                } else {
                    console.warn(`[VAST] Could not extract Ad element from VAST for element ${elementId}`);
                }
            } catch (error) {
                console.error(`[VAST] Error generating VAST for element ${element.meta?.id || element._id}:`, error);
            }
        }

        if (adXmlStrings.length === 0) {
            return res.status(500).json({ error: "Failed to generate any Ad elements" });
        }

        // Build combined VAST XML string manually (simpler than xmlbuilder for combining)
        // Ensure only ONE XML declaration at the very start
        let combinedXmlString = '<?xml version="1.0" encoding="UTF-8"?>\n';
        combinedXmlString += '<VAST version="4.1">\n';

        // Add all Ad elements with proper indentation
        adXmlStrings.forEach(adXml => {
            // Clean any remaining XML declarations or whitespace
            let cleanAd = adXml.replace(/<\?xml[^>]*\?>/gi, '').trim();

            // Indent each line of the Ad XML
            const indentedAd = cleanAd.split('\n').map((line) => {
                const trimmed = line.trim();
                if (trimmed === '') return '';
                return '  ' + trimmed;
            }).filter(line => line !== '').join('\n');

            combinedXmlString += indentedAd + '\n';
        });

        combinedXmlString += '</VAST>';

        // Save to S3 for future requests (using brandId as key)
        await uploadToS3(brandVastKey, combinedXmlString);
        console.log(`[VAST] Combined brand VAST saved to S3: ${brandVastKey}`);

        res.set("Content-Type", "application/xml");
        // Ensure clean XML - remove any content before XML declaration and ensure proper format
        let cleanXml = combinedXmlString.trim();
        // Remove any XML declarations that might be duplicated
        cleanXml = cleanXml.replace(/<\?xml[^>]*\?>\s*/g, '');
        // Add single XML declaration at the start
        cleanXml = '<?xml version="1.0" encoding="UTF-8"?>\n' + cleanXml;
        return res.send(cleanXml);

    } catch (error) {
        console.error("Random Brand VAST Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
