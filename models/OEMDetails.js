const mongoose = require('mongoose');
const crypto = require('crypto');

const oemDetailsSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  device_models_supported: {
    type: [String],
    required: true,
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: 'At least one device model is required'
    }
  },
  api_key: {
    type: String,
    required: false,
    unique: true,
    sparse: true
  },
  region_coverage: {
    type: [String],
    required: true,
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: 'At least one region is required'
    }
  },
  content_partnership_status: {
    type: String,
    required: true,
    enum: ['Active', 'Pending'],
    default: 'Pending'
  }
}, {
  timestamps: true
});

// Auto-generate API key if not provided
oemDetailsSchema.pre('save', function(next) {
  if (!this.api_key) {
    this.api_key = 'oem_' + crypto.randomBytes(32).toString('hex');
  }
  next();
});

// Note: user_id and api_key already have unique: true which creates indexes automatically

const OEMDetails = mongoose.model('OEMDetails', oemDetailsSchema);

module.exports = OEMDetails;
