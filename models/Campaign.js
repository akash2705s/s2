const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 200
  },
  brandId: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tvEnvironments: {
    type: [String],
    required: true,
    enum: ['ROKU', 'Fire TV', 'VIZIO', 'Samsung', 'LG'],
    validate: {
      validator: function(v) {
        return v.length > 0;
      },
      message: 'At least one TV environment must be selected'
    }
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'completed'],
    default: 'draft'
  },
  adUnits: [{
    elementId: {
      type: String, // Changed from ObjectId to String to match OverlayElement's custom string _id
      ref: 'OverlayElement',
      required: true
    },
    environment: {
      type: String,
      enum: ['ROKU', 'Fire TV', 'VIZIO', 'Samsung', 'LG'],
      required: true
    },
    status: {
      type: String,
      enum: ['running', 'paused', 'stopped'],
      default: 'running'
    }
  }]
}, {
  timestamps: true
});

// Index for faster queries
campaignSchema.index({ userId: 1, brandId: 1 });
campaignSchema.index({ brandId: 1 });

const Campaign = mongoose.model('Campaign', campaignSchema);

module.exports = Campaign;
