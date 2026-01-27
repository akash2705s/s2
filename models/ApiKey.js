const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema({
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
  name: {
    type: String,
    required: false,
    trim: true,
    default: 'API Key'
  },
  key: {
    type: String,
    required: true,
    unique: true
  },
  prefix: {
    type: String,
    // required: true
  },
  lastUsedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  permissions: {
    type: [String],
    default: ['read', 'write'],
    enum: ['read', 'write', 'delete', 'admin']
  },
  rateLimit: {
    requestsPerMinute: {
      type: Number,
      default: 60
    },
    requestsPerDay: {
      type: Number,
      default: 10000
    }
  },
  metadata: {
    type: Map,
    of: String,
    default: {}
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
apiKeySchema.index({ userId: 1, brandId: 1 });
apiKeySchema.index({ brandId: 1, isActive: 1 });

// Generate API key before saving
apiKeySchema.pre('save', function (next) {
  if (this.isNew && !this.key) {
    // Generate a secure random API key
    const randomBytes = crypto.randomBytes(32).toString('hex');
    this.prefix = `sk_${this.brandId.toString().slice(-8)}`;
    this.key = `${this.prefix}_${randomBytes}`;
  }
  next();
});

// Static method to find by brand
apiKeySchema.statics.findByBrand = function (brandId, includeInactive = false) {
  const query = { brandId };
  if (!includeInactive) {
    query.isActive = true;
  }
  return this.find(query).sort({ createdAt: -1 });
};

// Static method to find by user
apiKeySchema.statics.findByUser = function (userId, includeInactive = false) {
  const query = { userId };
  if (!includeInactive) {
    query.isActive = true;
  }
  return this.find(query)
    .populate('brandId', 'name description')
    .sort({ createdAt: -1 });
};

// Static method to verify and get API key
apiKeySchema.statics.verifyKey = async function (key) {
  const apiKey = await this.findOne({ key, isActive: true });

  if (!apiKey) {
    return null;
  }

  // Check if expired
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null;
  }

  // Update last used timestamp
  apiKey.lastUsedAt = new Date();
  await apiKey.save();

  return apiKey;
};

// Instance method to check if key is expired
apiKeySchema.methods.isExpired = function () {
  return this.expiresAt && this.expiresAt < new Date();
};

// Instance method to mask key for display
apiKeySchema.methods.getMaskedKey = function () {
  const keyParts = this.key.split('_');
  if (keyParts.length >= 3) {
    return `${keyParts[0]}_${keyParts[1]}_${'*'.repeat(8)}${keyParts[2].slice(-4)}`;
  }
  return `${this.key.substring(0, 12)}...${this.key.slice(-4)}`;
};

// Don't return the full key in JSON responses by default
apiKeySchema.methods.toJSON = function () {
  const obj = this.toObject();
  // Only show masked key in responses (except when explicitly needed)
  if (obj.key && !this._showFullKey) {
    obj.maskedKey = this.getMaskedKey();
    delete obj.key;
  }
  return obj;
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
