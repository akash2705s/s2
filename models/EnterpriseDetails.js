const mongoose = require('mongoose');

const enterpriseDetailsSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    industry_sector: {
        type: String,
        required: true,
        trim: true,
        minlength: 2,
        maxlength: 100
    },
    employee_count: {
        type: Number,
        required: false,
        min: 1
    },
    custom_integration_needs: {
        type: String,
        required: false,
        trim: true,
        maxlength: 500
    },
    dedicated_account_manager: {
        type: Boolean,
        required: false,
        default: false
    }
}, {
    timestamps: true
});

// Note: user_id already has unique: true which creates an index automatically

const EnterpriseDetails = mongoose.model('EnterpriseDetails', enterpriseDetailsSchema);

module.exports = EnterpriseDetails;
