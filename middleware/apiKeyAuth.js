const ApiKey = require('../models/ApiKey');

/**
 * Middleware to authenticate API key from request headers
 * Checks for API key in 'X-API-Key' or 'Authorization: Bearer' header
 * Attaches apiKey and brand info to request object if valid
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    // Get API key from headers
    let apiKeyString = req.headers['x-api-key'];
    
    // Also check Authorization header with Bearer token
    if (!apiKeyString) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        apiKeyString = authHeader.substring(7);
      }
    }

    if (!apiKeyString) {
      return res.status(401).json({ error: 'API key required' });
    }

    // Verify API key
    const apiKey = await ApiKey.verifyKey(apiKeyString);

    if (!apiKey) {
      return res.status(401).json({ error: 'Invalid or expired API key' });
    }

    // Check if key is active
    if (!apiKey.isActive) {
      return res.status(401).json({ error: 'API key is inactive' });
    }

    // Attach API key info to request
    req.apiKey = {
      id: apiKey._id,
      userId: apiKey.userId,
      brandId: apiKey.brandId,
      permissions: apiKey.permissions,
      rateLimit: apiKey.rateLimit
    };

    // Also set user id for compatibility with existing middleware
    req.user = {
      id: apiKey.userId.toString()
    };

    next();
  } catch (error) {
    console.error('API key authentication error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Middleware to check if API key has required permission
 * @param {string} permission - Required permission (read, write, delete, admin)
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({ error: 'API key authentication required' });
    }

    const permissions = req.apiKey.permissions || [];
    
    // Admin has all permissions
    if (permissions.includes('admin')) {
      return next();
    }

    // Check specific permission
    if (!permissions.includes(permission)) {
      return res.status(403).json({ 
        error: `Insufficient permissions. Required: ${permission}`,
        yourPermissions: permissions
      });
    }

    next();
  };
};

/**
 * Middleware to enforce rate limiting based on API key settings
 * Note: This is a simple in-memory implementation
 * For production, use Redis or similar for distributed rate limiting
 */
const rateLimitByApiKey = (() => {
  const requestCounts = new Map();
  const dayCounts = new Map();

  // Reset counters periodically
  setInterval(() => {
    requestCounts.clear();
  }, 60 * 1000); // Reset per-minute counts every minute

  setInterval(() => {
    dayCounts.clear();
  }, 24 * 60 * 60 * 1000); // Reset per-day counts every day

  return (req, res, next) => {
    if (!req.apiKey) {
      return next();
    }

    const keyId = req.apiKey.id.toString();
    const { requestsPerMinute = 60, requestsPerDay = 10000 } = req.apiKey.rateLimit;

    // Check per-minute limit
    const minuteKey = `${keyId}:minute`;
    const minuteCount = (requestCounts.get(minuteKey) || 0) + 1;
    
    if (minuteCount > requestsPerMinute) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        limit: requestsPerMinute,
        window: 'per minute',
        retryAfter: 60
      });
    }
    requestCounts.set(minuteKey, minuteCount);

    // Check per-day limit
    const dayKey = `${keyId}:day`;
    const dayCount = (dayCounts.get(dayKey) || 0) + 1;
    
    if (dayCount > requestsPerDay) {
      return res.status(429).json({ 
        error: 'Daily rate limit exceeded',
        limit: requestsPerDay,
        window: 'per day'
      });
    }
    dayCounts.set(dayKey, dayCount);

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit-Minute', requestsPerMinute);
    res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, requestsPerMinute - minuteCount));
    res.setHeader('X-RateLimit-Limit-Day', requestsPerDay);
    res.setHeader('X-RateLimit-Remaining-Day', Math.max(0, requestsPerDay - dayCount));

    next();
  };
})();

module.exports = {
  authenticateApiKey,
  requirePermission,
  rateLimitByApiKey
};
