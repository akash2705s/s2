/**
 * Permissions mapping for each role
 * This defines what actions each role can perform
 */

const PERMISSIONS = {
    // SuperAdmin has ALL permissions
    SUPERADMIN: [
        'create_user',
        'view_all_users',
        'delete_user',
        'manage_system',
        'upload_content',
        'view_analytics',
        'manage_ad_slots',
        'manage_devices',
        'configure_ad_placements',
        'access_oem_dashboard',
        'bid_on_inventory',
        'run_campaigns',
        'view_rtb_data',
        'access_server_logs',
        'configure_scaling',
        'monitor_system_health',
        'create_custom_campaigns',
        'access_enterprise_analytics',
        'integrate_external_tools'
    ],

    PUBLISHER: [
        'upload_content',
        'view_analytics',
        'manage_ad_slots'
    ],

    OEM: [
        'manage_devices',
        'configure_ad_placements',
        'access_oem_dashboard'
    ],

    DSP: [
        'bid_on_inventory',
        'run_campaigns',
        'view_rtb_data'
    ],

    INFRASTRUCTURE: [
        'access_server_logs',
        'configure_scaling',
        'monitor_system_health'
    ],

    ENTERPRISE: [
        'create_custom_campaigns',
        'access_enterprise_analytics',
        'integrate_external_tools'
    ]
};

/**
 * Get permissions for a role
 * @param {string} role - User role
 * @returns {string[]} Array of permission strings
 */
function getPermissionsForRole(role) {
    if (!role) {
        return [];
    }
    return PERMISSIONS[role.toUpperCase()] || [];
}

/**
 * Check if a role has a specific permission
 * @param {string} role - User role
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
function hasPermission(role, permission) {
    const permissions = getPermissionsForRole(role);
    return permissions.includes(permission);
}

/**
 * Get all available permissions (for admin UI)
 * @returns {string[]}
 */
function getAllPermissions() {
    const allPerms = new Set();
    Object.values(PERMISSIONS).forEach(perms => {
        perms.forEach(p => allPerms.add(p));
    });
    return Array.from(allPerms).sort();
}

module.exports = {
    PERMISSIONS,
    getPermissionsForRole,
    hasPermission,
    getAllPermissions
};
