const ApiKey = require('../models/ApiKey');
const Brand = require('../models/Brand');
const crypto = require('crypto');

// Create new API key for a brand
const createApiKey = async (req, res) => {
  try {
    const userId = req.user.id;
    const { brandId, name, expiresAt, permissions, rateLimit } = req.body;

    // Validation - only brandId is required
    if (!brandId) {
      return res.status(400).json({ error: 'Brand ID is required' });
    }

    // Verify brand exists and belongs to user
    const brand = await Brand.findOne({ _id: brandId, userId });
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found or does not belong to you' });
    }

    // Auto-generate name if not provided
    const keyName = name || `${brand.name} API Key`;

    // Generate unique API key
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const prefix = `sk_${brandId.toString().slice(-8)}`;
    const generatedKey = `${prefix}_${randomBytes}`;

    // Create API key
    const apiKey = new ApiKey({
      userId,
      brandId,
      name: keyName,
      key: generatedKey,
      prefix: prefix,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      permissions: permissions || ['read', 'write'],
      rateLimit: rateLimit || {}
    });

    await apiKey.save();

    // Return the full API key (only shown once)
    res.status(201).json({
      message: 'API key created successfully',
      apiKey: {
        id: apiKey._id,
        userId: apiKey.userId,
        brandId: apiKey.brandId,
        name: apiKey.name,
        key: apiKey.key, // Full key returned only on creation
        prefix: apiKey.prefix || '',
        permissions: apiKey.permissions,
        rateLimit: apiKey.rateLimit,
        isActive: apiKey.isActive,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt
      },
      warning: 'Please save this API key securely. You will not be able to see it again.'
    });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all API keys for the authenticated user
// Note: Keys are masked for security. Full key is only shown once during creation/regeneration.
// If user lost their key, they must regenerate it using the regenerate endpoint.
const getAllApiKeys = async (req, res) => {
  try {
    const userId = req.user.id;
    const { brandId, isActive, includeExpired } = req.query;

    let query = { userId };

    // Filter by brand if provided
    if (brandId) {
      query.brandId = brandId;
    }

    // Filter by active status if provided
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    let apiKeys = await ApiKey.find(query)
      .populate('brandId', 'name description logo')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    // Filter out expired keys unless explicitly requested
    if (includeExpired !== 'true') {
      apiKeys = apiKeys.filter(key => !key.isExpired());
    }

    // Mark expired keys in response
    // Keys are automatically masked by the toJSON method in the model
    const enrichedKeys = apiKeys.map(key => ({
      ...key.toJSON(),
      isExpired: key.isExpired()
    }));

    res.json({
      count: enrichedKeys.length,
      apiKeys: enrichedKeys,
      note: 'API keys are masked for security. If you need the full key, you must regenerate it.'
    });
  } catch (error) {
    console.error('Get all API keys error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get API keys by brand ID
const getApiKeysByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const userId = req.user.id;
    const { includeInactive } = req.query;

    // Verify brand belongs to user
    const brand = await Brand.findOne({ _id: brandId, userId });
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found or does not belong to you' });
    }

    const apiKeys = await ApiKey.findByBrand(brandId, includeInactive === 'true');

    // Mark expired keys
    const enrichedKeys = apiKeys.map(key => ({
      ...key.toJSON(),
      isExpired: key.isExpired()
    }));

    res.json({
      count: enrichedKeys.length,
      apiKeys: enrichedKeys
    });
  } catch (error) {
    console.error('Get API keys by brand error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid brand ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get API key by ID
// Note: Key is masked for security. If user needs the full key, they must regenerate it.
const getApiKeyById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const apiKey = await ApiKey.findOne({ _id: id, userId })
      .populate('brandId', 'name description logo')
      .populate('userId', 'name email');

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({
      apiKey: {
        ...apiKey.toJSON(),
        isExpired: apiKey.isExpired()
      },
      note: 'API key is masked for security. If you need the full key, use the regenerate endpoint.'
    });
  } catch (error) {
    console.error('Get API key by ID error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid API key ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update API key
const updateApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { name, permissions, rateLimit, metadata, expiresAt } = req.body;

    const apiKey = await ApiKey.findOne({ _id: id, userId });

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // Update allowed fields
    if (name) apiKey.name = name;
    if (permissions) apiKey.permissions = permissions;
    if (rateLimit) apiKey.rateLimit = { ...apiKey.rateLimit, ...rateLimit };
    if (metadata) apiKey.metadata = metadata;
    if (expiresAt !== undefined) {
      apiKey.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    await apiKey.save();

    res.json({
      message: 'API key updated successfully',
      apiKey: {
        ...apiKey.toJSON(),
        isExpired: apiKey.isExpired()
      }
    });
  } catch (error) {
    console.error('Update API key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Toggle API key active status
const toggleApiKeyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const apiKey = await ApiKey.findOne({ _id: id, userId });

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    apiKey.isActive = !apiKey.isActive;
    await apiKey.save();

    res.json({
      message: `API key ${apiKey.isActive ? 'activated' : 'deactivated'} successfully`,
      apiKey: {
        ...apiKey.toJSON(),
        isExpired: apiKey.isExpired()
      }
    });
  } catch (error) {
    console.error('Toggle API key status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete API key (soft delete by deactivating)
const deleteApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { permanent } = req.query;

    const apiKey = await ApiKey.findOne({ _id: id, userId });

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (permanent === 'true') {
      // Permanent deletion
      await apiKey.deleteOne();
      res.json({
        message: 'API key permanently deleted',
        apiKey: apiKey.toJSON()
      });
    } else {
      // Soft delete - just deactivate
      apiKey.isActive = false;
      await apiKey.save();
      res.json({
        message: 'API key deactivated',
        apiKey: {
          ...apiKey.toJSON(),
          isExpired: apiKey.isExpired()
        }
      });
    }
  } catch (error) {
    console.error('Delete API key error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid API key ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Regenerate API key (creates new key, deactivates old one)
const regenerateApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const oldApiKey = await ApiKey.findOne({ _id: id, userId });

    if (!oldApiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // Deactivate old key
    oldApiKey.isActive = false;
    await oldApiKey.save();

    // Create new key with same settings
    const newApiKey = new ApiKey({
      userId: oldApiKey.userId,
      brandId: oldApiKey.brandId,
      name: `${oldApiKey.name} (Regenerated)`,
      expiresAt: oldApiKey.expiresAt,
      permissions: oldApiKey.permissions,
      rateLimit: oldApiKey.rateLimit,
      metadata: oldApiKey.metadata
    });

    await newApiKey.save();

    res.json({
      message: 'API key regenerated successfully',
      oldKey: {
        id: oldApiKey._id,
        maskedKey: oldApiKey.getMaskedKey(),
        deactivated: true
      },
      newKey: {
        id: newApiKey._id,
        userId: newApiKey.userId,
        brandId: newApiKey.brandId,
        name: newApiKey.name,
        key: newApiKey.key, // Full key returned only on regeneration
        prefix: newApiKey.prefix,
        permissions: newApiKey.permissions,
        rateLimit: newApiKey.rateLimit,
        isActive: newApiKey.isActive,
        expiresAt: newApiKey.expiresAt,
        createdAt: newApiKey.createdAt,
        updatedAt: newApiKey.updatedAt
      },
      warning: 'Please save this API key securely. You will not be able to see it again.'
    });
  } catch (error) {
    console.error('Regenerate API key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Verify API key (for external use)
const verifyApiKey = async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const apiKey = await ApiKey.verifyKey(key);

    if (!apiKey) {
      return res.status(401).json({ 
        error: 'Invalid or expired API key',
        valid: false
      });
    }

    res.json({
      valid: true,
      apiKey: {
        id: apiKey._id,
        name: apiKey.name,
        brandId: apiKey.brandId,
        permissions: apiKey.permissions,
        rateLimit: apiKey.rateLimit,
        lastUsedAt: apiKey.lastUsedAt
      }
    });
  } catch (error) {
    console.error('Verify API key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createApiKey,
  getAllApiKeys,
  getApiKeysByBrand,
  getApiKeyById,
  updateApiKey,
  toggleApiKeyStatus,
  deleteApiKey,
  regenerateApiKey,
  verifyApiKey
};
