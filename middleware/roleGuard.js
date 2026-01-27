const { ROLES } = require('../models/User');

/**
 * Role-based access control middleware
 * Ensures the authenticated user has one of the required roles
 * 
 * @param {...string} allowedRoles - Roles that can access this route
 * @returns {Function} Express middleware function
 */
function roleGuard(...allowedRoles) {
    return async (req, res, next) => {
        try {
            // Ensure user is authenticated first (should be called after authenticateToken)
            if (!req.user || !req.user.id) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            // Fetch full user document to get role
            const User = require('../models/User');
            const user = await User.findById(req.user.id).select('role');

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Check if user has required role
            if (!allowedRoles.includes(user.role)) {
                return res.status(403).json({
                    error: 'Insufficient permissions',
                    required: allowedRoles,
                    current: user.role
                });
            }

            // Attach user role to request for downstream use
            req.user.role = user.role;
            next();
        } catch (error) {
            console.error('Role guard error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

/**
 * SuperAdmin-only guard (convenience wrapper)
 */
function superAdminOnly(req, res, next) {
    return roleGuard(ROLES.SUPERADMIN)(req, res, next);
}

module.exports = {
    roleGuard,
    superAdminOnly
};
