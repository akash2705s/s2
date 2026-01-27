// actions/vastAction.js
const xmlbuilder = require("xmlbuilder");
const Element = require("../models/OverlayElement");
const { s3Client } = require("../config/aws");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const https = require("https");
const http = require("http");
const bucket = process.env.S3_BUCKET_NAME;
const TRACKING_QUERY = '?elementType=l-banner&interactionType=l-squeeze';

// Helper: clean XML string to remove duplicate declarations
function cleanXmlString(xmlString) {
    if (!xmlString) return xmlString;
    // Remove duplicate XML declarations (keep only the first one)
    return xmlString.replace(/^<\?xml[^>]*\?>\s*<\?xml[^>]*\?>/m, '<?xml version="1.0" encoding="UTF-8"?>');
}

// Helper: check if VAST exists in S3
async function checkS3Cache(elementId) {
    try {
        const key = `vast/${elementId}.xml`;
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const response = await s3Client.send(cmd);

        const body = await response.Body.transformToString();
        // Clean any duplicate XML declarations from cached XML
        return cleanXmlString(body);
    } catch (err) {
        return null; // not in cache
    }
}

// Helper: Format seconds to HH:MM:SS
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Helper: Get video duration from video URL
// Attempts to get duration from video metadata using range requests
async function getVideoDuration(videoUrl) {
    if (!videoUrl) return null;

    try {
        // For MP4 files, try to get duration from moov atom
        // Make a range request to get the last few KB where moov atom might be
        return new Promise((resolve) => {
            const url = new URL(videoUrl);
            const client = url.protocol === 'https:' ? https : http;

            // First, try to get file size
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + (url.search || ''),
                method: 'HEAD',
                headers: {
                    'Range': 'bytes=0-1'
                }
            };

            const req = client.request(options, (res) => {
                const contentLength = parseInt(res.headers['content-length'] || '0', 10);
                const acceptRanges = res.headers['accept-ranges'];

                if (!acceptRanges || contentLength === 0) {
                    console.log("Video doesn't support range requests or has no content-length");
                    resolve(null);
                    return;
                }

                // Try to get the last 64KB where moov atom typically is
                const rangeStart = Math.max(0, contentLength - 65536);
                const rangeEnd = contentLength - 1;

                const rangeOptions = {
                    hostname: url.hostname,
                    port: url.port || (url.protocol === 'https:' ? 443 : 80),
                    path: url.pathname + (url.search || ''),
                    method: 'GET',
                    headers: {
                        'Range': `bytes=${rangeStart}-${rangeEnd}`
                    }
                };

                const rangeReq = client.request(rangeOptions, (rangeRes) => {
                    let data = Buffer.alloc(0);

                    rangeRes.on('data', (chunk) => {
                        data = Buffer.concat([data, chunk]);
                    });

                    rangeRes.on('end', () => {
                        try {
                            // Look for mvhd atom (movie header) which contains duration
                            const buffer = data;
                            let duration = null;

                            // Search for 'mvhd' atom (4 bytes)
                            for (let i = 0; i < buffer.length - 20; i++) {
                                if (buffer[i] === 0x6D && buffer[i + 1] === 0x76 &&
                                    buffer[i + 2] === 0x68 && buffer[i + 3] === 0x64) {
                                    // Found mvhd atom
                                    // Duration is typically at offset +12 or +20 depending on version
                                    const version = buffer[i + 8];
                                    const timescaleOffset = version === 1 ? 20 : 12;
                                    const durationOffset = version === 1 ? 24 : 16;

                                    if (i + durationOffset + 4 <= buffer.length) {
                                        const timescale = buffer.readUInt32BE(i + timescaleOffset);
                                        const durationTicks = version === 1
                                            ? Number(buffer.readBigUInt64BE(i + durationOffset))
                                            : buffer.readUInt32BE(i + durationOffset);

                                        if (timescale > 0) {
                                            duration = durationTicks / timescale;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (duration) {
                                console.log(`Detected video duration: ${duration} seconds`);
                                resolve(formatDuration(duration));
                            } else {
                                console.log("Could not find duration in video metadata");
                                resolve(null);
                            }
                        } catch (error) {
                            console.warn("Error parsing video metadata:", error.message);
                            resolve(null);
                        }
                    });
                });

                rangeReq.on('error', (error) => {
                    console.warn("Error fetching video range:", error.message);
                    resolve(null);
                });

                rangeReq.end();
            });

            req.on('error', (error) => {
                console.warn("Error fetching video HEAD:", error.message);
                resolve(null);
            });

            req.end();
        });
    } catch (error) {
        console.warn("Failed to get video duration:", error.message);
        return null;
    }
}

// Helper: save VAST to S3
async function saveToS3(elementId, xmlString) {
    try {
        if (!bucket) {
            console.warn("S3_BUCKET_NAME not configured, skipping S3 cache");
            return null;
        }
        const key = `vast/${elementId}.xml`;

        const cmd = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: xmlString,
            ContentType: "application/xml",
            ACL: "public-read" // optional
        });

        await s3Client.send(cmd);
        return `https://${bucket}.s3.amazonaws.com/${key}`;
    } catch (err) {
        console.warn("Failed to save VAST to S3:", err.message);
        return null; // Don't fail the request if S3 save fails
    }
}

function addSegmentViewTracking(xmlNode, domainName, elementId, segmentId) {
    if (!xmlNode || !domainName || !elementId || !segmentId) return;
    const trackingEvents = xmlNode.ele("TrackingEvents");
    trackingEvents.ele("Tracking", { event: "creativeView" })
        .cdata(`${domainName}/api/track/creativeView/${elementId}/${segmentId}${TRACKING_QUERY}`);
}

function appendPollXml(targetNode, segmentConfig = {}) {
    if (!targetNode || !segmentConfig) return;
    const pollSource = segmentConfig.poll || {};
    const question = pollSource.question ?? segmentConfig.pollQuestion;
    const heading = pollSource.heading ?? segmentConfig.pollHeading;
    const tagline = pollSource.tagline ?? segmentConfig.pollTagline;
    const options =
        (Array.isArray(pollSource.options) && pollSource.options.length
            ? pollSource.options
            : Array.isArray(segmentConfig.pollOptions)
                ? segmentConfig.pollOptions
                : []) || [];

    if (!question && options.length === 0 && !heading && !tagline) {
        return;
    }

    const pollNode = targetNode.ele("Poll");
    if (heading) {
        pollNode.ele("Heading").cdata(heading);
    }
    if (question) {
        pollNode.ele("Question").cdata(question);
    }
    if (tagline) {
        pollNode.ele("Tagline").cdata(tagline);
    }
    options.forEach((option) => {
        if (option) {
            pollNode.ele("Option").cdata(option);
        }
    });
    // Handle background: image takes priority over color
    const pollBgImage = segmentConfig.pollBackgroundImage || segmentConfig.poll?.backgroundImage;
    if (pollBgImage && pollBgImage.trim()) {
        console.log(`[VAST] Adding BackgroundImage to poll: ${pollBgImage.trim()}`);
        pollNode.ele("BackgroundImage").cdata(pollBgImage.trim());
    } else if (segmentConfig.backgroundColor) {
        console.log(`[VAST] Adding BackgroundColor to poll: ${segmentConfig.backgroundColor}`);
        pollNode.ele("BackgroundColor").cdata(segmentConfig.backgroundColor);
    }
}

function appendPollClickTracking(node, elementId, domainName) {
    if (!node || !elementId || !domainName) return;
    const trackingEvents = node.ele("TrackingEvents");
    trackingEvents.ele("Tracking", { event: "click" })
        .cdata(`${domainName}/api/track/creativeClick/${elementId}/segment1${TRACKING_QUERY}`);
}

// Helper: Generate VAST XML for corner banner
async function generateCornerBannerVast(element, domainName) {
    const cfg = element.configuration || {};
    const layout = cfg.layout || {};
    const content = cfg.content || {};
    const position = layout.position || 'bottom-left';
    const dimensions = layout.dimensions || { width: 600, height: 250 };

    // Get banner style (modular system)
    const bannerStyle = content.style || 'standard';

    // Get VAST display timing
    const vastConfig = cfg.vast || {};
    const displayConfig = vastConfig.display || {};
    const startOffset = displayConfig.startOffset || "00:00:03";
    const endOffset = displayConfig.endOffset || "00:00:13";

    // Get global showBannersOnPause setting from AdConfiguration (brand-level)
    let showBannersOnPauseSetting = true; // default
    if (element.brandId) {
        try {
            const AdConfiguration = require('../models/AdConfiguration');
            const adConfig = await AdConfiguration.findOne({ brandId: element.brandId });
            if (adConfig?.lBanner?.showBannersOnPause !== undefined) {
                showBannersOnPauseSetting = adConfig.lBanner.showBannersOnPause;
                console.log(`[VAST] Corner Banner - Using global showBannersOnPause setting: ${showBannersOnPauseSetting}`);
            }
        } catch (error) {
            console.warn(`[VAST] Failed to fetch global showBannersOnPause for corner banner:`, error);
        }
    }

    // Element-level behavior setting takes precedence over global
    const behavior = cfg.behavior || {};
    const showOnPause = behavior.showBannersOnPause !== undefined
        ? behavior.showBannersOnPause
        : showBannersOnPauseSetting;

    // Build VAST XML structure
    const xml = xmlbuilder.create("VAST", { version: "1.0", encoding: "UTF-8" })
        .att("version", "4.1");

    const ad = xml.ele("Ad", { id: element._id.toString() });
    const inline = ad.ele("InLine");

    inline.ele("AdSystem", { version: "4.1" }).txt("CanvasAdServer");
    inline.ele("AdTitle").txt(element.meta?.title || "Corner Banner Ad");

    // Impression tracking
    inline.ele("Impression")
        .cdata(`${domainName}/api/track/impression/${element._id}?elementType=corner-banner`);

    // Creatives section
    const creatives = inline.ele("Creatives");

    const isInteractiveKitchen =
        bannerStyle === 'split-interactive' || bannerStyle === 'kitchen';

    if (isInteractiveKitchen) {
        // Interactive styles:
        // - split-interactive: Santa image on left + poll with QR
        // - kitchen: hero image + poll with QR (no explicit Santa theming)

        // Get Santa image (left side)
        const santaImage = content.santaImage || {};
        const santaImageUrl = santaImage.uploadedMedia || santaImage.url || '';
        const santaImageWidth = santaImage.width || 400;
        const santaImageMaxHeight = santaImage.maxHeight || 550;

        // Get poll data (right side)
        const poll = content.poll || {};
        const pollOptions = Array.isArray(poll.options) ? poll.options : [];
        const pollHeading = poll.heading || "Santa's checking his list";
        const pollQuestion = poll.question || "";
        const leftButtonText = poll.leftButtonText || "Press Left for Nice List";
        const rightButtonText = poll.rightButtonText || "Press Right for Naughty List";
        const pollWidth = poll.width || 900;
        const pollHeight = poll.height || 500;
        const qrDisplayDurationSeconds = Number.isFinite(poll.qrDisplayDurationSeconds)
            ? poll.qrDisplayDurationSeconds
            : parseInt(poll.qrDisplayDurationSeconds, 10) || 40;

        // Get QR code
        const qrCode = poll.qrCode || {};
        const qrCodeUrl = qrCode.uploadedMedia || qrCode.url || '';
        const qrCodeText = qrCode.text || "";
        const qrCodeSubtext = qrCode.subtext || "";
        const qrCodeBranding = qrCode.branding || "";

        // Main corner banner NonLinear ad (combines Santa + Poll)
        const creative = creatives.ele("Creative", {
            id: `corner-banner-${element._id}`,
            sequence: "1"
        });
        const nonlinearAds = creative.ele("NonLinearAds");

        const nonlinear = nonlinearAds.ele("NonLinear", {
            id: `corner-banner-main-${element._id}`,
            width: dimensions.width || 600,
            height: dimensions.height || 250,
            scalable: "true",
            maintainAspectRatio: "true",
            minSuggestedDuration: "00:00:15"
        });

        // Use placeholder for now (player will render the interactive banner)
        nonlinear.ele("StaticResource", { creativeType: "image/png" })
            .cdata(`https://via.placeholder.com/${dimensions.width}x${dimensions.height}/ffffff/000000?text=Corner+Banner`);

        // Tracking events
        const trackingEvents = nonlinear.ele("TrackingEvents");
        trackingEvents.ele("Tracking", { event: "creativeView" })
            .cdata(`${domainName}/api/track/creativeView/${element._id}/main`);

        // Extensions with corner banner data
        const extensions = inline.ele("Extensions");
        const ext = extensions.ele("Extension", { type: "corner-banner" });
        const cornerBanner = ext.ele("CornerBanner");

        cornerBanner.ele("Position").txt(position);
        cornerBanner.ele("Width").txt(dimensions.width || 600);
        cornerBanner.ele("Height").txt(dimensions.height || 250);
        // Preserve style name so analytics can differentiate \"kitchen\" vs \"split-interactive\"
        cornerBanner.ele("Style").txt(bannerStyle);

        // Hero image data (serialized as SantaImage for backwards compatibility)
        // For kitchen style this is just the hero/background image, not necessarily Santa.
        if (santaImageUrl) {
            const santaNode = cornerBanner.ele("SantaImage");
            santaNode.ele("ImageURL").cdata(santaImageUrl);
            santaNode.ele("Width").txt(santaImageWidth);
            santaNode.ele("MaxHeight").txt(santaImageMaxHeight);
        }

        // Poll data
        const pollNode = cornerBanner.ele("Poll");
        pollNode.ele("Width").txt(pollWidth);
        pollNode.ele("Height").txt(pollHeight);
        if (pollHeading) pollNode.ele("Heading").cdata(pollHeading);
        if (pollQuestion) pollNode.ele("Question").cdata(pollQuestion);
        if (leftButtonText) {
            const leftButtonNode = pollNode.ele("LeftButtonText");
            leftButtonNode.cdata(leftButtonText);
            appendPollClickTracking(leftButtonNode, element._id, domainName);
        }
        if (rightButtonText) {
            const rightButtonNode = pollNode.ele("RightButtonText");
            rightButtonNode.cdata(rightButtonText);
            appendPollClickTracking(rightButtonNode, element._id, domainName);
        }
        if (pollOptions.length > 0) {
            pollOptions.forEach((optionText) => {
                if (!optionText) return;
                const optionNode = pollNode.ele("Option");
                optionNode.cdata(optionText);
                appendPollClickTracking(optionNode, element._id, domainName);
            });
        }

        // QR Code data
        if (qrCodeUrl || qrCodeText) {
            const qrNode = pollNode.ele("QRCode");
            if (qrCodeUrl) qrNode.ele("ImageURL").cdata(qrCodeUrl);
            if (qrCodeText) qrNode.ele("Text").cdata(qrCodeText);
            if (qrCodeSubtext) qrNode.ele("Subtext").cdata(qrCodeSubtext);
            if (qrCodeBranding) qrNode.ele("Branding").cdata(qrCodeBranding);
            appendPollClickTracking(qrNode, element._id, domainName);
        }

        // QR display duration - controls how long the corner banner stays visible after showing QR
        if (qrDisplayDurationSeconds && Number.isFinite(qrDisplayDurationSeconds) && qrDisplayDurationSeconds > 0) {
            pollNode.ele("QRDisplayDurationSeconds").txt(qrDisplayDurationSeconds);
        }

        // Display timing
        const disp = cornerBanner.ele("Display");
        disp.ele("StartOffset").txt(startOffset);
        disp.ele("EndOffset").txt(endOffset);

        // Behavior (ShowOnPause) - use element setting or global setting
        const behaviorNode = cornerBanner.ele("Behavior");
        behaviorNode.ele("ShowOnPause").txt(showOnPause ? "true" : "false");
    } else {
        // Standard style
        const mainImageUrl = content.uploadedMedia || content.mediaSource || '';
        const contentType = content.type || 'image';

        // Get corner image (Santa)
        const cornerImage = content.cornerImage || {};
        const cornerImageUrl = cornerImage.uploadedMedia || cornerImage.url || '';
        const showCornerImage = cornerImage.enabled !== false && cornerImageUrl;

        // Main banner NonLinear ad
        if (mainImageUrl || contentType === 'poll') {
            const creative = creatives.ele("Creative", {
                id: `corner-banner-main-${element._id}`,
                sequence: "1"
            });
            const nonlinearAds = creative.ele("NonLinearAds");

            const nonlinear = nonlinearAds.ele("NonLinear", {
                id: `main-banner-${element._id}`,
                width: dimensions.width || 300,
                height: dimensions.height || 250,
                scalable: "true",
                maintainAspectRatio: "true",
                minSuggestedDuration: "00:00:15"
            });

            if (contentType === 'poll') {
                const pollBgImage = content.pollBackgroundImage;
                const bgColor = content.backgroundColor || '#6366f1';

                if (pollBgImage) {
                    nonlinear.ele("StaticResource", { creativeType: "image/png" })
                        .cdata(pollBgImage);
                } else {
                    nonlinear.ele("StaticResource", { creativeType: "image/png" })
                        .cdata(`https://via.placeholder.com/${dimensions.width}x${dimensions.height}/${bgColor.replace('#', '')}/ffffff?text=Poll`);
                }
            } else if (mainImageUrl) {
                nonlinear.ele("StaticResource", { creativeType: "image/png" })
                    .cdata(mainImageUrl);
            } else {
                nonlinear.ele("StaticResource", { creativeType: "image/png" })
                    .cdata(`https://via.placeholder.com/${dimensions.width}x${dimensions.height}`);
            }

            if (content.redirectionUrl) {
                nonlinear.ele("NonLinearClickThrough")
                    .cdata(`${domainName}/api/track/click/${element._id}/main?redirect=${encodeURIComponent(content.redirectionUrl)}`);
            }

            const trackingEvents = nonlinear.ele("TrackingEvents");
            trackingEvents.ele("Tracking", { event: "creativeView" })
                .cdata(`${domainName}/api/track/creativeView/${element._id}/main`);
        }

        // Corner image (Santa) NonLinear ad
        if (showCornerImage) {
            const creativeCorner = creatives.ele("Creative", {
                id: `corner-image-${element._id}`,
                sequence: "2"
            });
            const nonlinearAdsCorner = creativeCorner.ele("NonLinearAds");

            const nonlinearCorner = nonlinearAdsCorner.ele("NonLinear", {
                id: `corner-image-${element._id}`,
                width: "150",
                height: "200",
                scalable: "true",
                maintainAspectRatio: "true",
                minSuggestedDuration: "00:00:15"
            });

            nonlinearCorner.ele("StaticResource", { creativeType: "image/png" })
                .cdata(cornerImageUrl);

            const trackingEventsCorner = nonlinearCorner.ele("TrackingEvents");
            trackingEventsCorner.ele("Tracking", { event: "creativeView" })
                .cdata(`${domainName}/api/track/creativeView/${element._id}/corner-image`);
        }

        // Extensions for corner banner positioning
        const extensions = inline.ele("Extensions");
        const ext = extensions.ele("Extension", { type: "corner-banner" });
        const cornerBanner = ext.ele("CornerBanner");

        cornerBanner.ele("Position").txt(position);
        cornerBanner.ele("Width").txt(dimensions.width || 300);
        cornerBanner.ele("Height").txt(dimensions.height || 250);
        cornerBanner.ele("Style").txt("standard");

        // Display timing
        const disp = cornerBanner.ele("Display");
        disp.ele("StartOffset").txt(startOffset);
        disp.ele("EndOffset").txt(endOffset);
    }

    const xmlString = xml.end({
        pretty: true,
        xmldec: { version: "1.0", encoding: "UTF-8" }
    });

    return xmlString.trim().replace(/^[^\<]*/, '');
}

// Helper: Generate VAST XML for full-page banner (poll only, no video ad)
async function generateFullPageBannerVast(element, domainName) {
    const cfg = element.configuration || {};
    const content = cfg.content || {};
    const poll = content.poll || {};
    const vastConfig = cfg.vast || {};
    const displayConfig = vastConfig.display || {};

    // Get time triggers (new modular system)
    const timeTriggers = displayConfig.timeTriggers || [];

    // Build VAST XML
    const xml = xmlbuilder.create("VAST", { version: "1.0", encoding: "UTF-8" })
        .att("version", "4.1");

    const ad = xml.ele("Ad", { id: element._id.toString() });
    const inline = ad.ele("InLine");

    inline.ele("AdSystem", { version: "4.1" }).txt("CanvasAdServer");
    inline.ele("AdTitle").txt(element.meta?.title || "Full Page Banner Ad");

    // Impression tracking
    inline.ele("Impression")
        .cdata(`${domainName}/api/track/impression/${element._id}?elementType=full-page-ad`);

    // Full Page Banner Extension
    const extensions = inline.ele("Extensions");
    const extension = extensions.ele("Extension", { type: "full-page-banner" });
    const fullPageBanner = extension.ele("FullPageBanner");

    // Poll configuration
    if (poll.heading || poll.question || (poll.options && poll.options.length > 0)) {
        const pollNode = fullPageBanner.ele("Poll");
        if (poll.heading) {
            pollNode.ele("Heading").cdata(poll.heading);
        }
        if (poll.question) {
            pollNode.ele("Question").cdata(poll.question);
        }
        if (poll.options && Array.isArray(poll.options)) {
            poll.options.forEach((option) => {
                if (option) {
                    const optionNode = pollNode.ele("Option");
                    optionNode.cdata(option);
                    appendPollClickTracking(optionNode, element._id, domainName);
                }
            });
        }
        // Background images
        const pollBgImage = poll.backgroundImage || poll.backgroundImageUploaded;
        if (pollBgImage) {
            pollNode.ele("BackgroundImage").cdata(pollBgImage);
        }
    }

    // QR Code configuration
    const qrCode = poll.qrCode || {};
    if (qrCode.text || qrCode.url || qrCode.uploadedMedia) {
        const qrCodeNode = fullPageBanner.ele("QRCode");
        if (qrCode.text) {
            qrCodeNode.ele("Text").cdata(qrCode.text);
        }
        if (qrCode.subtext) {
            qrCodeNode.ele("Subtext").cdata(qrCode.subtext);
        }
        if (qrCode.branding) {
            qrCodeNode.ele("Branding").cdata(qrCode.branding);
        }
        const qrCodeUrl = qrCode.url || qrCode.uploadedMedia;
        if (qrCodeUrl) {
            qrCodeNode.ele("ImageURL").cdata(qrCodeUrl);
        }
        // QR code background image
        const qrBgImage = poll.qrBackgroundImage || poll.qrBackgroundImageUploaded;
        if (qrBgImage) {
            qrCodeNode.ele("BackgroundImage").cdata(qrBgImage);
        }
        appendPollClickTracking(qrCodeNode, element._id, domainName);
    }

    // Display timing - Time Triggers (REQUIRED for full-page banners, no fallback)
    const display = fullPageBanner.ele("Display");
    if (timeTriggers.length > 0) {
        const timeTriggersNode = display.ele("TimeTriggers");
        timeTriggers.forEach((trigger) => {
            const triggerNode = timeTriggersNode.ele("TimeTrigger");
            triggerNode.ele("TriggerTime").txt(trigger.triggerTime || "00:01:00");
            triggerNode.ele("Duration").txt(String(trigger.duration || 15));
        });
    } else {
        // Default trigger if none specified (at 1 minute, 15 seconds duration)
        const timeTriggersNode = display.ele("TimeTriggers");
        const triggerNode = timeTriggersNode.ele("TimeTrigger");
        triggerNode.ele("TriggerTime").txt("00:01:00");
        triggerNode.ele("Duration").txt("15");
    }

    // Behavior
    const behavior = cfg.behavior || {};
    const behaviorNode = fullPageBanner.ele("Behavior");
    if (behavior.showCloseButton !== undefined) {
        behaviorNode.ele("ShowCloseButton").txt(behavior.showCloseButton ? "true" : "false");
    }

    const xmlString = xml.end({
        pretty: true,
        xmldec: { version: "1.0", encoding: "UTF-8" }
    });

    return xmlString.trim().replace(/^[^\<]*/, '');
}

// Helper: Generate VAST XML string from element object (reusable for both individual and brand VAST generation)
exports.generateVastXmlString = async function generateVastXmlString(element) {
    // Get base URL for tracking endpoints
    const domainName = process.env.DOMAIN_NAME || 'https://canvas-siau-server-dev.vercel.app';

    // Check if this is a corner banner (different VAST structure)
    // Check multiple possible locations for element type
    const elementType = element.meta?.type ||
        element.meta?.elementType ||
        element.elementType ||
        '';

    // Also check if configuration has corner banner specific structure
    const cfg = element.configuration || {};
    const cornerContent = cfg.content || {};
    const cornerLayout = cfg.layout || {};

    // Strong indicators of corner banner:
    // 1. Has split-interactive or kitchen style
    // 2. Has santaImage or poll in content
    // 3. Has layout.position but NO layout.segments (corner banners don't use segments)
    const hasSplitInteractive =
        cornerContent.style === 'split-interactive' || cornerContent.style === 'kitchen';
    const hasSantaImage = !!(cornerContent.santaImage && (cornerContent.santaImage.url || cornerContent.santaImage.uploadedMedia));
    const hasPoll = !!(cornerContent.poll && (cornerContent.poll.heading || cornerContent.poll.question));
    const hasCornerLayout = !!(cornerLayout.position && !cornerLayout.segments);

    const hasCornerBannerConfig = hasSplitInteractive || hasSantaImage || hasPoll || hasCornerLayout;

    // Check for full-page banner
    const isFullPageAd = elementType === 'full-page-ad' ||
        (cornerContent.type === 'poll' && cornerContent.poll && cornerContent.videoAd);

    console.log(`[VAST] Element type check for ${element._id}:`);
    console.log(`  - meta.type: ${element.meta?.type}`);
    console.log(`  - meta.elementType: ${element.meta?.elementType}`);
    console.log(`  - content.type: ${cornerContent.type}`);
    console.log(`  - isFullPageAd: ${isFullPageAd}`);
    console.log(`  - hasCornerBannerConfig: ${hasCornerBannerConfig}`);

    if (isFullPageAd) {
        console.log(`[VAST] ✅ Detected as FULL PAGE BANNER - Generating full-page banner VAST`);
        return await generateFullPageBannerVast(element, domainName);
    }

    if (elementType === 'corner-banner' || hasCornerBannerConfig) {
        console.log(`[VAST] ✅ Detected as CORNER BANNER - Generating corner banner VAST`);
        return await generateCornerBannerVast(element, domainName);
    }

    console.log(`[VAST] ⚠️ Not detected as corner banner - Generating L-Banner VAST`);

    const layout = element.configuration.layout?.segments || [];

    // Get global showBannersOnPause setting from AdConfiguration (brand-level)
    let showBannersOnPauseSetting = true; // default
    if (element.brandId) {
        try {
            const AdConfiguration = require('../models/AdConfiguration');
            // AdConfiguration.brandId is now String (matching Brand._id)
            const adConfig = await AdConfiguration.findOne({ brandId: element.brandId });
            if (adConfig?.lBanner?.showBannersOnPause !== undefined) {
                showBannersOnPauseSetting = adConfig.lBanner.showBannersOnPause;
                console.log(`[VAST] Using global showBannersOnPause setting: ${showBannersOnPauseSetting} for brand ${element.brandId}`);
            } else {
                console.log(`[VAST] No global setting found for brand ${element.brandId}, using default: ${showBannersOnPauseSetting}`);
            }
        } catch (error) {
            console.warn('[VAST] Failed to fetch global showBannersOnPause setting, using default:', error.message);
        }
    }

    // Handle multiple content formats:
    // 1. content.elements (array) - new format
    // 2. content.segment1, content.segment2 - old format
    // 3. content.elements.segment1, content.elements.segment2 - mixed format
    let content = element.configuration.content;
    let contentArray = [];

    if (content) {
        if (Array.isArray(content)) {
            // Already an array
            contentArray = content;
        } else if (content.elements) {
            if (Array.isArray(content.elements)) {
                // New format: content.elements = [...]
                contentArray = content.elements;
            } else if (typeof content.elements === 'object') {
                // Mixed format: content.elements = {segment1: {...}, segment2: {...}}
                contentArray = Object.values(content.elements);
            }
        } else {
            // Old format: content = {segment1: {...}, segment2: {...}}
            // Check if it has segment1/segment2 keys
            if (content.segment1 || content.segment2) {
                contentArray = [
                    content.segment1,
                    content.segment2
                ].filter(Boolean); // Remove undefined/null
            } else {
                // Try to extract any object values
                contentArray = Object.values(content).filter(v => v && typeof v === 'object' && !Array.isArray(v));
            }
        }
    }

    content = contentArray;

    const getSeg = (pos) => {
        const segLayout = layout.find(s => s.position === pos);
        if (!segLayout) return null;

        // Try to find content by segmentId
        let segContent = content.find(c => c && (c.segmentId === segLayout.id || c.id === segLayout.id));

        // If not found, try to find by index (segment1 = index 0, segment2 = index 1)
        if (!segContent && layout.length === content.length && content.length > 0) {
            const index = layout.findIndex(s => s.id === segLayout.id);
            if (index >= 0 && index < content.length) {
                segContent = content[index];
            }
        }

        // If still not found, try accessing content directly by segment ID (old format: content.segment1, content.segment2)
        if (!segContent && element.configuration.content) {
            const rawContent = element.configuration.content;
            const segmentKey = segLayout.id; // 'segment1' or 'segment2'

            // Try: content.elements.segment1 or content.elements.segment2
            if (rawContent.elements && typeof rawContent.elements === 'object' && !Array.isArray(rawContent.elements)) {
                if (rawContent.elements[segmentKey]) {
                    segContent = rawContent.elements[segmentKey];
                }
            }
            // Try: content.segment1 or content.segment2 (old format)
            if (!segContent && rawContent[segmentKey]) {
                segContent = rawContent[segmentKey];
            }
        }

        // If still not found, create a minimal content object from layout
        if (!segContent) {
            segContent = {
                id: segLayout.id,
                segmentId: segLayout.id,
                type: 'image',
                media: { url: '' },
                button: {
                    enabled: false,
                    label: pos === 'bottom' ? 'Learn More' : 'Get Offer',
                    url: '',
                    position: { x: 0, y: 0, width: 0, height: 0 }
                }
            };
        }

        return { ...segContent, layout: segLayout };
    };

    // Determine L-banner layout position (left-bottom or right-bottom)
    const layoutPosition = element.configuration?.layout?.position || 'left-bottom';
    const isRightBottom = layoutPosition === 'right-bottom';

    const horizontal = getSeg("bottom");
    // Get vertical segment based on layout position
    const vertical = getSeg(isRightBottom ? "right" : "left");

    // Get main video URL from configuration (allow empty - player can supply video separately)
    const mainVideoUrl = element.configuration?.mainVideoUrl || "";

    // Get VAST display timing
    const vastConfig = element.configuration?.vast || {};
    const displayConfig = vastConfig.display || {};
    const startOffset = displayConfig.startOffset || "00:00:03";
    const endOffset = displayConfig.endOffset || "00:00:13";

    // Try to get video duration dynamically from video URL, fallback to default
    let videoDuration = "00:01:00";
    if (mainVideoUrl) {
        const detectedDuration = await getVideoDuration(mainVideoUrl);
        if (detectedDuration) {
            videoDuration = detectedDuration;
        }
    }
    const videoClickThrough = vastConfig.video?.clickThrough || "";

    // Build complete VAST XML structure
    const xml = xmlbuilder.create("VAST", { version: "1.0", encoding: "UTF-8" })
        .att("version", "4.1");

    const ad = xml.ele("Ad", { id: element._id.toString() });
    const inline = ad.ele("InLine");

    inline.ele("AdSystem", { version: "4.1" }).txt("CanvasAdServer");
    inline.ele("AdTitle").txt(element.meta?.title || "L-Banner Ad");

    // Impression tracking with elementType
    inline.ele("Impression")
        .cdata(`${domainName}/api/track/impression/${element._id}?elementType=l-banner&interactionType=l-squeeze`);

    // Creatives section with Linear video
    const creatives = inline.ele("Creatives");

    if (mainVideoUrl) {
        const creative = creatives.ele("Creative", {
            id: `linear-${element._id}`,
            sequence: "1"
        });
        const linear = creative.ele("Linear");

        linear.ele("Duration").txt(videoDuration);

        const mediaFiles = linear.ele("MediaFiles");
        mediaFiles.ele("MediaFile", {
            delivery: "progressive",
            type: "video/mp4",
            width: "1920",
            height: "1080",
            bitrate: "3500"
        }).cdata(mainVideoUrl);

        const trackingEvents = linear.ele("TrackingEvents");
        trackingEvents.ele("Tracking", { event: "start" })
            .cdata(`${domainName}/api/track/start/${element._id}`);
        trackingEvents.ele("Tracking", { event: "firstQuartile" })
            .cdata(`${domainName}/api/track/firstQuartile/${element._id}`);
        trackingEvents.ele("Tracking", { event: "midpoint" })
            .cdata(`${domainName}/api/track/midpoint/${element._id}`);
        trackingEvents.ele("Tracking", { event: "thirdQuartile" })
            .cdata(`${domainName}/api/track/thirdQuartile/${element._id}`);
        trackingEvents.ele("Tracking", { event: "complete" })
            .cdata(`${domainName}/api/track/complete/${element._id}`);
        if (videoClickThrough) {
            const videoClicks = linear.ele("VideoClicks");
            videoClicks.ele("ClickThrough").cdata(videoClickThrough);
        }
    }

    // Extensions with LBanner
    const extensions = inline.ele("Extensions");
    const ext = extensions.ele("Extension", { type: "l-banner" });
    const lBanner = ext.ele("LBanner");

    // ================== Horizontal ====================
    if (horizontal) {
        const h = lBanner.ele("Horizontal");
        // Variant support: pick default variant if provided
        const variants = Array.isArray(horizontal.variants) ? horizontal.variants : [];
        const defaultVariantId = horizontal.defaultVariant || variants[0]?.id;
        const defaultVariant = variants.find((v) => v.id === defaultVariantId);
        const imageUrl =
            defaultVariant?.media?.url ||
            horizontal.media?.url ||
            "https://via.placeholder.com/400x120";
        h.ele("ImageURL").cdata(imageUrl);
        if (variants.length > 0) {
            const variantsNode = h.ele("Variants");
            variants.forEach((v) => {
                const vNode = variantsNode.ele("Variant", { id: v.id || "" });
                vNode.ele("Label").txt(v.label || v.id || "Option");
                vNode.ele("ImageURL").cdata(v.media?.url || "");
            });
            h.ele("DefaultVariant").txt(defaultVariantId || variants[0].id || "");
        }
        const position = horizontal.layout?.position || 'bottom';

        const horizontalWidth = horizontal.layout?.width || 150;
        const horizontalHeight = horizontal.layout?.height || 120;

        const shellWidth = 1280;
        const margin = 40;
        const hasCustomX = typeof horizontal.layout?.x === "number";
        const horizontalX = hasCustomX
            ? horizontal.layout.x
            : margin;
        const horizontalY = position === 'bottom' ? 760 : 40;

        h.ele("Width").txt(horizontalWidth);
        h.ele("Height").txt(horizontalHeight);
        h.ele("X").txt(horizontalX);
        h.ele("Y").txt(horizontalY);

        const horizontalSegmentId = horizontal.segmentId || horizontal.id || 'segment2';
        const hasHorizontalButton = horizontal.button?.enabled;

        const btnWrap = h.ele("Buttons");

        // Variant-driven dual buttons (left/right) -> switch action
        if (variants.length > 0) {
            variants.forEach((v, idx) => {
                const btn = btnWrap.ele("Button", {
                    id: `${horizontalSegmentId}-${v.id || idx}`,
                    role: idx === 0 ? "primary" : "secondary",
                    defaultFocus: idx === 0 ? "true" : "false",
                });
                btn.ele("Label").txt(v.label || (idx === 0 ? "Left" : "Right"));

                const pos = btn.ele("Position");
                const btnPos = v.position || horizontal.button?.position || {};
                pos.ele("X").txt(btnPos.x || (idx === 0 ? 520 : 680));
                pos.ele("Y").txt(btnPos.y || 780);
                pos.ele("Width").txt(btnPos.width || 140);
                pos.ele("Height").txt(btnPos.height || 50);

                const action = btn.ele("Action", { type: "custom" });
                action.ele("CustomAction").txt(`switch:${v.id || idx}`);

                const track = btn.ele("TrackingEvents");
                track.ele("Tracking", { event: "click" })
                    .cdata(`${domainName}/api/track/creativeClick/${element._id}/${horizontalSegmentId}${TRACKING_QUERY}`);
            });
            addSegmentViewTracking(h, domainName, element._id, horizontalSegmentId);
        } else if (hasHorizontalButton) {
            const btn = btnWrap.ele("Button", {
                id: `${horizontalSegmentId}-btn`,
                defaultFocus: true,
                role: "primary"
            });
            btn.ele("Label").txt(horizontal.button?.label || "Learn More");

            const pos = btn.ele("Position");
            const btnPos = horizontal.button?.position || {};
            pos.ele("X").txt(btnPos.x || 520);
            pos.ele("Y").txt(btnPos.y || 780);
            pos.ele("Width").txt(btnPos.width || 140);
            pos.ele("Height").txt(btnPos.height || 50);

            const action = btn.ele("Action", { type: "clickthrough" });
            action.ele("ClickThrough").cdata(horizontal.button?.url || "");
            if (horizontal.button?.deepLink) {
                action.ele("DeepLink").cdata(horizontal.button.deepLink);
            } else {
                action.ele("DeepLink");
            }

            const track = btn.ele("TrackingEvents");
            track.ele("Tracking", { event: "click" })
                .cdata(`${domainName}/api/track/creativeClick/${element._id}/${horizontalSegmentId}${TRACKING_QUERY}`);

            addSegmentViewTracking(h, domainName, element._id, horizontalSegmentId);
        } else {
            addSegmentViewTracking(h, domainName, element._id, horizontalSegmentId);
        }

        // Interactive horizontal creative set (server-controlled)
        const interactiveHorizontal =
            horizontal.interactiveHorizontal ||
            element.configuration?.interactiveHorizontal ||
            null;
        if (interactiveHorizontal?.creatives?.length) {
            const setNode = h.ele("HorizontalCreativeSet", {
                defaultIndex: interactiveHorizontal.defaultIndex ?? 0,
                direction: interactiveHorizontal.navigation?.direction || "ltr",
                order: interactiveHorizontal.navigation?.order || "sequential",
                wrap: interactiveHorizontal.navigation?.wrap !== false,
            });
            const navEndpoint =
                interactiveHorizontal.navEndpoint ||
                `${domainName}/api/vast/${element._id}/horizontal/nav`;
            setNode.ele("NavEndpoint").cdata(navEndpoint);
            if (interactiveHorizontal.fallbackImageUrl) {
                setNode
                    .ele("FallbackImageURL")
                    .cdata(interactiveHorizontal.fallbackImageUrl);
            }
            const buttonsNode = setNode.ele("Buttons");
            if (interactiveHorizontal.buttons?.leftId) {
                buttonsNode.ele("LeftButton", { ref: interactiveHorizontal.buttons.leftId });
            }
            if (interactiveHorizontal.buttons?.rightId) {
                buttonsNode.ele("RightButton", { ref: interactiveHorizontal.buttons.rightId });
            }
            interactiveHorizontal.creatives.forEach((creative, idx) => {
                const creativeNode = setNode.ele("Creative", {
                    id: creative.id || `creative_${idx}`,
                    index: creative.index ?? idx,
                    direction: creative.direction || "any",
                });
                creativeNode
                    .ele("ImageURL")
                    .cdata(creative.imageUrl || creative.media?.url || "");
                if (creative.tracking) {
                    const trackingNode = creativeNode.ele("TrackingEvents");
                    Object.entries(creative.tracking).forEach(([event, url]) => {
                        if (url) {
                            trackingNode.ele("Tracking", { event }).cdata(url);
                        }
                    });
                }
            });

            // Navigation buttons (left/right) rendered after image
            if (interactiveHorizontal.buttons?.left || interactiveHorizontal.buttons?.right) {
                const navBtnWrap = h.ele("Buttons");
                const leftBtn = interactiveHorizontal.buttons.left || {};
                const rightBtn = interactiveHorizontal.buttons.right || {};

                if (interactiveHorizontal.buttons.left) {
                    const btn = navBtnWrap.ele("Button", {
                        id: interactiveHorizontal.buttons.leftId || `${horizontalSegmentId}-nav-left`,
                        role: "nav-left",
                        defaultFocus: "true",
                    });
                    btn.ele("Label").txt(leftBtn.label || "Left");
                    const pos = btn.ele("Position");
                    pos.ele("X").txt(leftBtn.position?.x ?? 0);
                    pos.ele("Y").txt(leftBtn.position?.y ?? (horizontalY + horizontalHeight + 10));
                    pos.ele("Width").txt(leftBtn.position?.width ?? 120);
                    pos.ele("Height").txt(leftBtn.position?.height ?? 50);
                    const track = btn.ele("TrackingEvents");
                    track.ele("Tracking", { event: "click" })
                        .cdata(`${domainName}/api/track/creativeClick/${element._id}/${horizontalSegmentId}-nav-left${TRACKING_QUERY}`);
                }

                if (interactiveHorizontal.buttons.right) {
                    const btn = navBtnWrap.ele("Button", {
                        id: interactiveHorizontal.buttons.rightId || `${horizontalSegmentId}-nav-right`,
                        role: "nav-right",
                        defaultFocus: "false",
                    });
                    btn.ele("Label").txt(rightBtn.label || "Right");
                    const pos = btn.ele("Position");
                    pos.ele("X").txt(rightBtn.position?.x ?? 160);
                    pos.ele("Y").txt(rightBtn.position?.y ?? (horizontalY + horizontalHeight + 10));
                    pos.ele("Width").txt(rightBtn.position?.width ?? 120);
                    pos.ele("Height").txt(rightBtn.position?.height ?? 50);
                    const track = btn.ele("TrackingEvents");
                    track.ele("Tracking", { event: "click" })
                        .cdata(`${domainName}/api/track/creativeClick/${element._id}/${horizontalSegmentId}-nav-right${TRACKING_QUERY}`);
                }
            }
        }
        if (horizontal.poll || horizontal.type === "poll") {
            console.log(`[VAST] Horizontal poll config:`, {
                pollBackgroundImage: horizontal.pollBackgroundImage,
                backgroundColor: horizontal.backgroundColor,
                type: horizontal.type,
                hasPoll: !!horizontal.poll
            });
            appendPollXml(h, horizontal);
        }
    }

    // ================== Vertical ====================
    if (vertical) {
        const v = lBanner.ele("Vertical");
        const imageUrl = vertical.media?.url || "";
        v.ele("ImageURL").cdata(imageUrl || "https://via.placeholder.com/200x300/1a1f2e/ffffff?text=Vertical+Banner");
        const verticalPosition = vertical.layout?.position || 'left';

        const verticalWidth = vertical.layout?.width || 200;
        const verticalHeight = vertical.layout?.height || 300;

        const shellWidth = 1280;
        const margin = 40;
        const verticalX = isRightBottom
            ? shellWidth - verticalWidth - margin
            : margin;
        const verticalY = 260;

        v.ele("Width").txt(verticalWidth);
        v.ele("Height").txt(verticalHeight);
        v.ele("X").txt(verticalX);
        v.ele("Y").txt(verticalY);

        const verticalSegmentId = vertical.segmentId || vertical.id || 'segment1';
        const hasVerticalButton = vertical.button?.enabled;

        if (hasVerticalButton) {
            const btnWrap = v.ele("Buttons");
            const btn = btnWrap.ele("Button", {
                id: `${verticalSegmentId}-btn`,
                role: "secondary"
            });
            btn.ele("Label").txt(vertical.button?.label || "Get Offer");

            const posV = btn.ele("Position");
            const btnPosV = vertical.button?.position || {};
            posV.ele("X").txt(btnPosV.x || 60);
            posV.ele("Y").txt(btnPosV.y || 640);
            posV.ele("Width").txt(btnPosV.width || 140);
            posV.ele("Height").txt(btnPosV.height || 60);

            const action = btn.ele("Action", { type: "clickthrough" });
            action.ele("ClickThrough").cdata(vertical.button?.url || "");
            if (vertical.button?.deepLink) {
                action.ele("DeepLink").cdata(vertical.button.deepLink);
            } else {
                action.ele("DeepLink");
            }

            const track = btn.ele("TrackingEvents");
            track.ele("Tracking", { event: "click" })
                .cdata(`${domainName}/api/track/creativeClick/${element._id}/${verticalSegmentId}${TRACKING_QUERY}`);

            addSegmentViewTracking(v, domainName, element._id, verticalSegmentId);
        } else {
            addSegmentViewTracking(v, domainName, element._id, verticalSegmentId);
        }
        if (vertical.poll || vertical.type === "poll") {
            console.log(`[VAST] Vertical poll config:`, {
                pollBackgroundImage: vertical.pollBackgroundImage,
                backgroundColor: vertical.backgroundColor,
                type: vertical.type,
                hasPoll: !!vertical.poll
            });
            appendPollXml(v, vertical);
        }
    } else {
        // Create fallback vertical segment to ensure L-banner structure is complete
        const shellWidth = 1280;
        const margin = 40;
        const fallbackWidth = 200;
        const fallbackX = isRightBottom
            ? shellWidth - fallbackWidth - margin
            : margin;

        const v = lBanner.ele("Vertical");
        v.ele("ImageURL").cdata("https://via.placeholder.com/200x300");
        v.ele("Width").txt("200");
        v.ele("Height").txt("300");
        v.ele("X").txt(fallbackX.toString());
        v.ele("Y").txt("260");
    }

    // ================== Display Timing ====================
    const disp = lBanner.ele("Display");
    disp.ele("StartOffset").txt(startOffset);
    disp.ele("EndOffset").txt(endOffset);

    const behaviorNode = lBanner.ele("Behavior");
    behaviorNode
        .ele("ShowOnPause")
        .txt(showBannersOnPauseSetting ? "true" : "false");

    const xmlString = xml.end({
        pretty: true,
        xmldec: { version: "1.0", encoding: "UTF-8" }
    });

    // Ensure clean XML string - trim and remove any leading content before XML declaration
    return xmlString.trim().replace(/^[^\<]*/, '');
}

exports.generateVastXml = async (req, res) => {
    try {
        const elementId = req.params.elementId;
        const forceGenerate = req.query.forceGenerate === "true";

        console.log("generateVastXml", forceGenerate, "elementId:", elementId);

        // Check S3 cache first (unless forcing regeneration)
        if (!forceGenerate) {
            const cached = await checkS3Cache(elementId);
            if (cached) {
                res.set("Content-Type", "application/xml");
                return res.send(cached);
            }
        }

        // Fetch element and generate VAST XML
        const element = await Element.findById(elementId);
        if (!element) {
            console.error("Element not found:", elementId);
            return res.status(404).json({ error: "Element not found" });
        }

        // Debug: Log element structure
        console.log(`[VAST] Element structure - meta:`, JSON.stringify(element.meta, null, 2));
        console.log(`[VAST] Element configuration.content.style:`, element.configuration?.content?.style);

        // Generate VAST XML using the shared helper function
        const xmlString = await exports.generateVastXmlString(element);

        // Save to S3 cache
        await saveToS3(elementId, xmlString);

        res.set("Content-Type", "application/xml");
        return res.send(xmlString);

    } catch (err) {
        console.error("LBanner XML Error:", err);
        console.error("Error stack:", err.stack);
        res.status(500).json({ error: "Internal server error", message: err.message });
    }
};

exports.generateVastXml_v1 = async (req, res) => {
    try {
        const elementId = req.params.elementId;
        const forceGenerate = req.query.forceGenerate === "true";

        // ---------------------------------------------------
        // STEP 1: CHECK CACHE (only if NOT forcing regeneration)
        // ---------------------------------------------------
        if (!forceGenerate) {
            const cached = await checkS3Cache(elementId);
            if (cached) {
                console.log("⚡ VAST served from S3 cache");
                res.set("Content-Type", "application/xml");
                return res.send(cached);
            }
        }

        console.log(forceGenerate ? "🔄 Force generating VAST…" : "⏳ Cache miss. Generating VAST…");


        // ---------------------------------------------------
        // STEP 2: FETCH ELEMENT DATA
        // ---------------------------------------------------
        const element = await Element.findById(elementId);
        if (!element) {
            return res.status(404).json({ error: "Element not found" });
        }

        const meta = element.meta;
        const cfg = element.configuration;
        const segments = cfg?.content?.elements || [];


        // ---------------------------------------------------
        // STEP 3: Determine video and image segments
        // ---------------------------------------------------
        let videoSegment = null;
        const imageSegments = [];

        segments.forEach(seg => {
            if (seg?.media?.fileType?.startsWith("video/") && !videoSegment) {
                videoSegment = seg; // FIRST video is used
            } else if (seg?.media?.fileType?.startsWith("image/")) {
                imageSegments.push(seg);
            }
        });

        // ---------------------------------------------------
        // STEP 4: BUILD VALID VAST 3.0 XML
        // ---------------------------------------------------
        const xml = xmlbuilder
            .create("VAST")
            .att("version", "3.0");

        const ad = xml.ele("Ad", { id: element._id.toString() });
        const inline = ad.ele("InLine");

        inline.ele("AdSystem", {}, "Canvas Interactive Ads");
        inline.ele("AdTitle", {}, meta?.title || "Canvas Ad");

        inline.ele(
            "Impression",
            {},
            `${process.env.DOMAIN_NAME}/api/track/impression/${element._id}`
        );


        const creatives = inline.ele("Creatives");


        // ---------------------------------------------------
        // STEP 5: Linear VIDEO CREATIVE (if video exists)
        // ---------------------------------------------------
        if (videoSegment) {
            const creativeLinear = creatives.ele("Creative");
            const linear = creativeLinear.ele("Linear");

            linear.ele("Duration", {}, "00:00:10"); // optional or auto detect

            // Recommended IMA compatible tracking
            const trackingEvents = linear.ele("TrackingEvents");

            trackingEvents.ele(
                "Tracking",
                { event: "start" },
                `${process.env.DOMAIN_NAME}/api/track/start/${element._id}`
            );

            trackingEvents.ele(
                "Tracking",
                { event: "firstQuartile" },
                `${process.env.DOMAIN_NAME}/api/track/firstQuartile/${element._id}`
            );

            trackingEvents.ele(
                "Tracking",
                { event: "midpoint" },
                `${process.env.DOMAIN_NAME}/api/track/midpoint/${element._id}`
            );

            trackingEvents.ele(
                "Tracking",
                { event: "thirdQuartile" },
                `${process.env.DOMAIN_NAME}/api/track/thirdQuartile/${element._id}`
            );

            trackingEvents.ele(
                "Tracking",
                { event: "complete" },
                `${process.env.DOMAIN_NAME}/api/track/complete/${element._id}`
            );

            const mediaFiles = linear.ele("MediaFiles");
            mediaFiles.ele(
                "MediaFile",
                {
                    delivery: "progressive",
                    type: videoSegment.media.fileType,
                    width: videoSegment.width || 1280,
                    height: videoSegment.height || 720,
                },
                videoSegment.media.url
            );
        }


        // ---------------------------------------------------
        // STEP 6: NONLINEAR LBANNER OVERLAY (images only)
        // ---------------------------------------------------
        if (imageSegments.length > 0) {
            const creativeNonLinear = creatives.ele("Creative");
            const nonlinearAds = creativeNonLinear.ele("NonLinearAds");

            imageSegments.forEach(seg => {
                const width = seg.width || 300;
                const height = seg.height || 250;

                const nonlinear = nonlinearAds.ele("NonLinear", {
                    id: seg.id,
                    width,
                    height,
                    scalable: "true",
                    maintainAspectRatio: "true",
                });

                nonlinear.ele(
                    "StaticResource",
                    { creativeType: seg.media.fileType },
                    seg.media.url
                );

                nonlinear.ele(
                    "NonLinearClickThrough",
                    {},
                    seg.button?.url || "https://default-url.com"
                );

                const trackingEventsNL = nonlinear.ele("TrackingEvents");

                trackingEventsNL.ele(
                    "Tracking",
                    { event: "creativeView" },
                    `${process.env.DOMAIN_NAME}/api/track/creativeView/${element._id}/${seg.id}`
                );
            });
        }


        // ---------------------------------------------------
        // STEP 7: XML OUTPUT
        // ---------------------------------------------------
        const xmlString = xml.end({
            pretty: true,
            xmldec: { version: "1.0", encoding: "UTF-8" }
        });


        // ---------------------------------------------------
        // STEP 8: SAVE TO S3 CACHE
        // ---------------------------------------------------
        await saveToS3(elementId, xmlString);
        console.log("✅ VAST regenerated & cached");


        // ---------------------------------------------------
        // STEP 9: RETURN XML
        // ---------------------------------------------------
        res.set("Content-Type", "application/xml");
        return res.send(xmlString);


    } catch (error) {
        console.error("VAST Generation Error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};


exports.generateVastXml_old = async (req, res) => {
    try {
        const elementId = req.params.elementId;

        // ---------------------------------------------------
        // STEP 1: CHECK CACHE
        // ---------------------------------------------------
        const cached = await checkS3Cache(elementId);
        if (cached) {
            console.log("⚡ VAST served from S3 cache");
            res.set("Content-Type", "application/xml");
            return res.send(cached);
        }

        console.log("⏳ Cache miss. Generating VAST…");

        // ---------------------------------------------------
        // STEP 2: FETCH ELEMENT DATA
        // ---------------------------------------------------
        const element = await Element.findById(elementId);
        if (!element) {
            return res.status(404).json({ error: "Element not found" });
        }

        const meta = element.meta;
        const cfg = element.configuration;
        const segments = cfg?.content?.elements || [];

        // ---------------------------------------------------
        // STEP 3: BUILD VAST XML
        // ---------------------------------------------------
        const xml = xmlbuilder
            .create("VAST")
            .att("version", "4.2");

        const ad = xml.ele("Ad", { id: element._id.toString() });
        const inline = ad.ele("InLine");

        inline.ele("AdSystem", {}, "Canvas Interactive Ads");
        inline.ele("AdTitle", {}, meta?.title || "Canvas Ad");

        inline.ele(
            "Impression",
            {},
            `${process.env.DOMAIN_NAME}/api/track/impression/${element._id}`
        );

        const creatives = inline.ele("Creatives");
        const creative = creatives.ele("Creative");
        const nonlinearAds = creative.ele("NonLinearAds");

        segments.forEach((seg) => {
            const nonlinear = nonlinearAds.ele("NonLinear", {
                id: seg.id,
                width: seg.width || 300,
                height: seg.height || 250,
                scalable: "true",
                maintainAspectRatio: "true"
            });

            nonlinear.ele(
                "StaticResource",
                { creativeType: seg.media.fileType },
                seg.media.url
            );

            nonlinear.ele(
                "NonLinearClickThrough",
                {},
                `${process.env.DOMAIN_NAME}/api/track/click/${element._id}/${seg.id}?redirect=${encodeURIComponent(seg.button?.url || "https://default.com")}`
            );

            nonlinear.ele("TrackingEvents")
                .ele(
                    "Tracking",
                    { event: "creativeView" },
                    `${process.env.DOMAIN_NAME}/api/track/creativeView/${element._id}/${seg.id}`
                );
        });

        const xmlString = xml.end({
            pretty: true,
            xmldec: { version: "1.0", encoding: "UTF-8" }
        });

        // ---------------------------------------------------
        // STEP 4: SAVE TO S3 CACHE
        // ---------------------------------------------------
        await saveToS3(elementId, xmlString);

        console.log("✅ VAST saved to cache");

        // ---------------------------------------------------
        // STEP 5: RETURN XML
        // ---------------------------------------------------
        res.set("Content-Type", "application/xml");
        return res.send(xmlString);

    } catch (error) {
        console.error("VAST Generation Error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * Handle interactive horizontal navigation for L-Corner / L-Banner variants.
 * Computes the next creative server-side and returns the updated image URL.
 */
exports.handleInteractiveHorizontalNav = async (req, res) => {
    try {
        const { elementId } = req.params;
        const { direction, currentIndex } = req.body || {};

        const element = await Element.findById(elementId);
        if (!element) {
            return res.status(404).json({ error: "Element not found" });
        }

        const interactiveCfg =
            element.configuration?.interactiveHorizontal ||
            element.configuration?.content?.interactiveHorizontal ||
            element.configuration?.content?.interactive?.horizontal ||
            null;

        const creatives =
            interactiveCfg?.creatives ||
            interactiveCfg?.variants ||
            [];

        if (!creatives.length) {
            return res.status(400).json({ error: "No interactive creatives configured" });
        }

        const wrap = interactiveCfg?.wrap !== false;
        const current = Number.isFinite(parseInt(currentIndex, 10))
            ? parseInt(currentIndex, 10)
            : interactiveCfg?.defaultIndex || 0;

        const dirToken = String(direction || "").toUpperCase();
        const delta = dirToken.includes("LEFT") ? -1 : 1;
        let nextIndex = current + delta;
        if (nextIndex < 0) {
            nextIndex = wrap ? creatives.length - 1 : 0;
        } else if (nextIndex >= creatives.length) {
            nextIndex = wrap ? 0 : creatives.length - 1;
        }

        const creative = creatives[nextIndex] || creatives[0];
        const imageUrl =
            creative?.imageUrl ||
            creative?.media?.url ||
            creative?.url ||
            interactiveCfg?.fallbackImageUrl ||
            null;

        return res.json({
            creativeIndex: nextIndex,
            creativeId: creative?.id || creative?._id || `creative_${nextIndex}`,
            imageUrl,
            tracking: {
                creativeSwitch:
                    creative?.tracking?.creativeSwitch ||
                    interactiveCfg?.tracking?.creativeSwitch ||
                    null,
            },
        });
    } catch (error) {
        console.error("Interactive navigation error:", error);
        return res.status(500).json({ error: "Navigation failed" });
    }
};
