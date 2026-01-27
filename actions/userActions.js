const bcrypt = require('bcrypt');
const User = require('../models/User');
const { ROLES } = require('../models/User');
const { getPermissionsForRole } = require('../utils/permissions');
const PublisherDetails = require('../models/PublisherDetails');
const OEMDetails = require('../models/OEMDetails');
const DSPDetails = require('../models/DSPDetails');
const InfrastructureDetails = require('../models/InfrastructureDetails');
const EnterpriseDetails = require('../models/EnterpriseDetails');

/**
 * Create user (SuperAdmin only)
 * Handles role-specific field validation and creation
 */
const createUser = async (req, res) => {
    try {
        const {
            full_name,
            email,
            password,
            phone_number,
            company_name,
            country,
            role,
            consent_to_terms,
            // Role-specific fields
            // Publisher
            website_url,
            content_categories,
            ad_integration_type,
            estimated_monthly_traffic,
            // OEM
            device_models_supported,
            api_key,
            region_coverage,
            content_partnership_status,
            // DSP
            dsp_platform_name,
            budget_allocation_method,
            target_audience_segments,
            integration_tokens,
            // Infrastructure
            infrastructure_type,
            capacity_metrics,
            sla_agreement_level,
            monitoring_tools_integrated,
            // Enterprise
            industry_sector,
            employee_count,
            custom_integration_needs,
            dedicated_account_manager
        } = req.body;

        // Common field validation
        if (!full_name || !email || !password || !company_name || !country || !role || consent_to_terms === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (full_name.length < 2 || full_name.length > 100) {
            return res.status(400).json({ error: 'Full name must be between 2 and 100 characters' });
        }

        if (company_name.length < 3 || company_name.length > 150) {
            return res.status(400).json({ error: 'Company name must be between 3 and 150 characters' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        if (!Object.values(ROLES).includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        if (!consent_to_terms) {
            return res.status(400).json({ error: 'Consent to terms is required' });
        }

        // Check if email already exists
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(409).json({ error: 'User with this email already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Get creator admin ID
        const creatorId = req.user.id;

        // Create user
        const user = new User({
            email: email.toLowerCase(),
            full_name,
            name: full_name, // Backward compatibility
            password: hashedPassword,
            phone_number: phone_number || undefined,
            company_name,
            country: country.toUpperCase(),
            role,
            consent_to_terms,
            created_by_admin_id: creatorId
        });

        await user.save();

        // Create role-specific details
        let roleDetails = null;
        try {
            switch (role) {
                case ROLES.PUBLISHER:
                    if (!website_url || !content_categories || !ad_integration_type) {
                        throw new Error('Publisher requires website_url, content_categories, and ad_integration_type');
                    }
                    roleDetails = new PublisherDetails({
                        user_id: user._id,
                        website_url,
                        content_categories: Array.isArray(content_categories) ? content_categories : [content_categories],
                        ad_integration_type,
                        estimated_monthly_traffic: estimated_monthly_traffic || undefined
                    });
                    await roleDetails.save();
                    break;

                case ROLES.OEM:
                    if (!device_models_supported || !region_coverage) {
                        throw new Error('OEM requires device_models_supported and region_coverage');
                    }
                    roleDetails = new OEMDetails({
                        user_id: user._id,
                        device_models_supported: Array.isArray(device_models_supported) ? device_models_supported : [device_models_supported],
                        api_key: api_key || undefined,
                        region_coverage: Array.isArray(region_coverage) ? region_coverage : [region_coverage],
                        content_partnership_status: content_partnership_status || 'Pending'
                    });
                    await roleDetails.save();
                    break;

                case ROLES.DSP:
                    if (!dsp_platform_name || !budget_allocation_method) {
                        throw new Error('DSP requires dsp_platform_name and budget_allocation_method');
                    }
                    roleDetails = new DSPDetails({
                        user_id: user._id,
                        dsp_platform_name,
                        budget_allocation_method,
                        target_audience_segments: target_audience_segments || [],
                        integration_tokens: integration_tokens || []
                    });
                    await roleDetails.save();
                    break;

                case ROLES.INFRASTRUCTURE:
                    if (!infrastructure_type || !sla_agreement_level) {
                        throw new Error('Infrastructure requires infrastructure_type and sla_agreement_level');
                    }
                    roleDetails = new InfrastructureDetails({
                        user_id: user._id,
                        infrastructure_type,
                        capacity_metrics: capacity_metrics || undefined,
                        sla_agreement_level,
                        monitoring_tools_integrated: monitoring_tools_integrated || []
                    });
                    await roleDetails.save();
                    break;

                case ROLES.ENTERPRISE:
                    if (!industry_sector) {
                        throw new Error('Enterprise requires industry_sector');
                    }
                    roleDetails = new EnterpriseDetails({
                        user_id: user._id,
                        industry_sector,
                        employee_count: employee_count || undefined,
                        custom_integration_needs: custom_integration_needs || undefined,
                        dedicated_account_manager: dedicated_account_manager || false
                    });
                    await roleDetails.save();
                    break;

                case ROLES.SUPERADMIN:
                    // SuperAdmin doesn't need role-specific details
                    console.log(`[USER CREATION] SuperAdmin created by admin ${creatorId}: ${email}`);
                    break;
            }
        } catch (roleError) {
            // If role-specific creation fails, delete the user
            await User.findByIdAndDelete(user._id);
            return res.status(400).json({ error: roleError.message });
        }

        res.status(201).json({
            message: 'User created successfully',
            user: {
                id: user._id.toString(),
                email: user.email,
                full_name: user.full_name,
                company_name: user.company_name,
                role: user.role,
                permissions: getPermissionsForRole(user.role),
                role_details: roleDetails ? roleDetails.toObject() : null
            }
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    createUser
};
