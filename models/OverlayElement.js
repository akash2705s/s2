const mongoose = require('mongoose');

const overlayElementSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true
  },
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
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  configuration: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  sharedWith: {
    type: [String], // Array of user emails who can view this banner as a reference
    default: []
  }
}, {
  timestamps: true,
  _id: false // Disable automatic _id generation since we're using custom string IDs
});

// Compound index for efficient user + brand queries
overlayElementSchema.index({ userId: 1, brandId: 1 });
// Index for sharedWith queries
overlayElementSchema.index({ sharedWith: 1 });

// Static method to find elements by brand
overlayElementSchema.statics.findByBrand = function (brandId) {
  return this.find({ brandId }).sort({ createdAt: -1 });
};

// Static method to find elements by user
overlayElementSchema.statics.findByUser = function (userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

const OverlayElement = mongoose.model('OverlayElement', overlayElementSchema);

module.exports = OverlayElement;
