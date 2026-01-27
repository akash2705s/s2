const mongoose = require('mongoose');

// Role enum - IMMUTABLE after creation
const ROLES = {
    SUPERADMIN: 'SUPERADMIN',
    PUBLISHER: 'PUBLISHER',
    OEM: 'OEM',
    DSP: 'DSP',
    INFRASTRUCTURE: 'INFRASTRUCTURE',
    ENTERPRISE: 'ENTERPRISE'
};

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        validate: {
            validator: function (v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: 'Invalid email format'
        }
    },
    password: {
        type: String,
        required: true
    },
    full_name: {
        type: String,
        required: false, // Made optional for backward compatibility
        trim: true,
        minlength: 2,
        maxlength: 100
    },
    // Keep 'name' for backward compatibility (maps to full_name)
    name: {
        type: String,
        required: false, // Made optional for backward compatibility
        trim: true
    },
    phone_number: {
        type: String,
        required: false,
        trim: true
    },
    company_name: {
        type: String,
        required: false, // Made optional for backward compatibility
        trim: true,
        minlength: 3,
        maxlength: 150
    },
    country: {
        type: String,
        required: false, // Made optional for backward compatibility
        trim: true,
        uppercase: true,
        maxlength: 2 // ISO 3166-1 alpha-2
    },
    role: {
        type: String,
        required: false, // Made optional for backward compatibility (existing users won't have role)
        enum: Object.values(ROLES),
        immutable: true // Role cannot be changed after creation
    },
    consent_to_terms: {
        type: Boolean,
        required: false,
        default: false
    },
    created_by_admin_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    defaultBrandId: {
        type: String,
        ref: 'Brand',
        default: null
    }
}, {
    timestamps: true
});

// Index for role-based queries
userSchema.index({ role: 1 });
// Note: email already has unique: true which creates an index automatically

// Method to remove password from user object
userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    delete user.__v;
    // Map full_name to name for backward compatibility if name doesn't exist
    if (!user.name && user.full_name) {
        user.name = user.full_name;
    }
    // Ensure backward compatibility: if name exists but full_name doesn't, map it
    if (!user.full_name && user.name) {
        user.full_name = user.name;
    }
    return user;
};

// Static method to find by email
userSchema.statics.findByEmail = function (email) {
    return this.findOne({ email: email.toLowerCase() });
};

// Static method to check if SuperAdmin exists
userSchema.statics.hasSuperAdmin = async function () {
    const count = await this.countDocuments({ role: ROLES.SUPERADMIN });
    return count > 0;
};

// Static method to get all SuperAdmins
userSchema.statics.getSuperAdmins = function () {
    return this.find({ role: ROLES.SUPERADMIN });
};

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
