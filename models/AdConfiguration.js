const mongoose = require('mongoose');

const adConfigurationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  brandId: {
    type: String,
    ref: 'Brand',
    required: true
  },
  brandName: {
    type: String,
    required: true
  },
  adPlacement: {
    preRoll: {
      enabled: {
        type: Boolean,
        default: true
      },
      frequency: {
        type: Number,
        default: 100,
        min: 0,
        max: 100
      }
    },
    midRoll: {
      enabled: {
        type: Boolean,
        default: true
      },
      interval: {
        type: Number,
        default: 600,
        min: 0
      },
      maxAds: {
        type: Number,
        default: 3,
        min: 0
      }
    },
    postRoll: {
      enabled: {
        type: Boolean,
        default: false
      }
    },
    pauseRoll: {
      enabled: {
        type: Boolean,
        default: true
      }
    }
  },
  targeting: {
    devices: {
      type: [String],
      enum: ['mobile', 'tablet', 'desktop', 'tv'],
      default: ['mobile', 'tablet', 'desktop', 'tv']
    },
    contentRating: {
      type: [String],
      enum: ['G', 'PG', 'PG-13', 'R', 'NC-17'],
      default: ['G', 'PG', 'PG-13']
    },
    timeTargeting: {
      type: String,
      enum: ['all-day', 'morning', 'afternoon', 'evening', 'night', 'custom'],
      default: 'all-day'
    },
    customTimeRange: {
      start: String, // Format: "HH:mm"
      end: String    // Format: "HH:mm"
    },
    geo: {
      type: [String],
      default: []
    }
  },
  playback: {
    skipEnabled: {
      type: Boolean,
      default: true
    },
    skipDelay: {
      type: Number,
      default: 5,
      min: 0
    },
    autoPlay: {
      type: Boolean,
      default: true
    },
    volume: {
      type: Number,
      default: 80,
      min: 0,
      max: 100
    },
    muteOnStart: {
      type: Boolean,
      default: false
    },
    // When true, ads should be shown only on the first video in a session in Free_Player
    disableAdsAfterFirstVideo: {
      type: Boolean,
      default: false
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lBanner: {
    showBannersOnPause: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
adConfigurationSchema.index({ userId: 1, brandId: 1 });

// Ensure one configuration per brand
adConfigurationSchema.index({ brandId: 1 }, { unique: true });

// Static method to find configuration by brand
adConfigurationSchema.statics.findByBrand = function (brandId) {
  return this.findOne({ brandId }).populate('brandId', 'name description').populate('userId', 'name email');
};

// Static method to find all configurations for a user
adConfigurationSchema.statics.findByUser = function (userId) {
  return this.find({ userId }).populate('brandId', 'name description').sort({ createdAt: -1 });
};

const AdConfiguration = mongoose.model('AdConfiguration', adConfigurationSchema);

module.exports = AdConfiguration;
