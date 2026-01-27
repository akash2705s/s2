const mongoose = require('mongoose');

const publisherDetailsSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    website_url: {
        type: String,
        required: true,
        trim: true,
        validate: {
            validator: function (v) {
                return /^https?:\/\/.+/.test(v);
            },
            message: 'Website URL must be a valid HTTP/HTTPS URL'
        }
    },
    content_categories: {
        type: [String],
        required: true,
        validate: {
            validator: function (v) {
                return Array.isArray(v) && v.length > 0;
            },
            message: 'At least one content category is required'
        }
    },
    ad_integration_type: {
        type: String,
        required: true,
        enum: ['Direct', 'Programmatic'],
        default: 'Programmatic'
    },
    estimated_monthly_traffic: {
        type: Number,
        required: false,
        min: 0
    }
}, {
    timestamps: true
});

// Note: user_id already has unique: true which creates an index automatically

const PublisherDetails = mongoose.model('PublisherDetails', publisherDetailsSchema);

module.exports = PublisherDetails;
