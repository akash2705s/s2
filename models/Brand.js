const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  logo: {
    type: String,
    default: ''
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  settings: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  _id: false // Disable automatic _id generation since we're using custom string IDs
});

// Index to ensure only one default brand per user
brandSchema.index({ userId: 1, isDefault: 1 });

// Static method to find brands by user
brandSchema.statics.findByUser = function(userId) {
  return this.find({ userId }).sort({ isDefault: -1, createdAt: -1 });
};

// Static method to get default brand for a user
brandSchema.statics.getDefaultBrand = function(userId) {
  return this.findOne({ userId, isDefault: true });
};

// Pre-save middleware to ensure only one default brand per user
brandSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    // Remove default status from other brands of this user
    await this.constructor.updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  next();
});

const Brand = mongoose.model('Brand', brandSchema);

module.exports = Brand;
