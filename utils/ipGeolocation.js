/**
 * IP Address and Geolocation Utility
 * 
 * Extracts IP from request headers and looks up geolocation data
 */

/**
 * Extract IP address from request headers
 * Priority: x-forwarded-for > x-real-ip > req.ip
 * In development, TEST_IP can override ONLY when no explicit header IP is provided.
 * 
 * @param {Object} req - Express request object
 * @returns {string} IP address
 */
function extractIP(req) {
    // Extract from headers (handles proxy/CDN scenarios)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        // x-forwarded-for can contain multiple IPs (client, proxy1, proxy2)
        // First IP is usually the original client IP
        const ips = forwardedFor.split(',').map(ip => ip.trim());
        return ips[0];
    }

    // Fallback to x-real-ip (set by some proxies)
    if (req.headers['x-real-ip']) {
        return req.headers['x-real-ip'];
    }

    // Base IP from Express (remote address)
    let baseIp = req.ip || req.connection?.remoteAddress || 'unknown';

    // In development, allow TEST_IP override ONLY when no header-based IP is set
    if (process.env.NODE_ENV === 'development' && process.env.TEST_IP) {
        baseIp = process.env.TEST_IP;
    }

    return baseIp;
}

/**
 * Lookup geolocation data for an IP address
 * Uses ipwho.is (no key required)
 * 
 * @param {string} ip - IP address
 * @returns {Promise<Object>} Geolocation data
 */
async function lookupGeolocation(ip) {
    // Skip lookup for localhost/private IPs in development
    if (process.env.NODE_ENV === 'development') {
        const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
        if (isLocalhost && !process.env.TEST_IP) {
            // Return mock data for localhost
            return {
                ip: ip,
                city: 'Local Development',
                region: 'Local',
                country: 'XX',
                country_name: 'Local',
                latitude: null,
                longitude: null,
                timezone: 'UTC',
                org: 'Local Network',
                isp: 'Local Network'
            };
        }
    }

    try {
        // Use ipwho.is for geolocation lookup
        // Note: fetch is available in Node.js 18+, which Express 5 requires
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(`https://ipwho.is/${ip}`, {
            headers: {
                'User-Agent': 'Canvas-Ad-Server/1.0'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error(`[GeoLookup] HTTP ${response.status} for IP ${ip}:`, errorText);
            return getDefaultGeoData(ip);
        }

        const data = await response.json();

        // Handle API errors
        if (data.success === false) {
            console.warn(`[GeoLookup] API error for IP ${ip}:`, data.message || 'Unknown error');
            return getDefaultGeoData(ip);
        }

        // Return standardized geo data
        return {
            ip: data.ip || ip,
            city: data.city || null,
            region: data.region || data.region_code || null,
            country: data.country_code || data.country || null,
            country_name: data.country || null,
            latitude: data.latitude || null,
            longitude: data.longitude || null,
            timezone: (data.timezone && data.timezone.id) || null,
            org: data.connection?.org || null,
            isp: data.connection?.isp || data.connection?.org || null
        };
    } catch (error) {
        // More detailed error logging
        if (error.name === 'AbortError') {
            console.error(`[GeoLookup] Timeout (5s) for IP ${ip} - ipwho.is too slow or unresponsive`);
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error(`[GeoLookup] Network error for IP ${ip}:`, error.message);
        } else {
            console.error(`[GeoLookup] Failed to lookup IP ${ip}:`, error.message, error.stack);
        }
        // Return default data on error
        return getDefaultGeoData(ip);
    }
}

/**
 * Get default/fallback geo data when lookup fails
 * 
 * @param {string} ip - IP address
 * @returns {Object} Default geo data
 */
function getDefaultGeoData(ip) {
    return {
        ip: ip,
        city: null,
        region: null,
        country: null,
        country_name: null,
        latitude: null,
        longitude: null,
        timezone: null,
        org: null,
        isp: null
    };
}

/**
 * Extract IP and lookup geolocation in one call
 * 
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Object with ip and geo data
 */
async function getIPAndGeo(req) {
    const ip = extractIP(req);
    const geo = await lookupGeolocation(ip);

    return {
        ip: geo.ip || ip,
        ...geo
    };
}

module.exports = {
    extractIP,
    lookupGeolocation,
    getIPAndGeo
};

