const AdConfiguration = require('../models/AdConfiguration');
const Brand = require('../models/Brand');

// Create or update ad configuration for a brand
const createOrUpdateAdConfig = async (req, res) => {
  try {
    const userId = req.user.id;
    const { brandId, brandName, adPlacement, targeting, playback, isActive, lBanner } = req.body;

    // Validation
    if (!brandId) {
      return res.status(400).json({ error: 'Brand ID is required' });
    }

    // Brand model uses String _id, not ObjectId
    // Verify brand exists and belongs to user
    const brand = await Brand.findOne({ _id: brandId, userId });
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found or does not belong to you' });
    }

    // Brand _id is a string, and AdConfiguration.brandId is now also String
    const resolvedBrandId = brand._id;
    
    // Find existing configuration
    let adConfig = await AdConfiguration.findOne({ brandId: resolvedBrandId });

    if (adConfig) {
      // Update existing configuration
      adConfig.brandName = brandName || brand.name;
      if (adPlacement) adConfig.adPlacement = adPlacement;
      if (targeting) adConfig.targeting = targeting;
      if (playback) adConfig.playback = playback;
      if (isActive !== undefined) adConfig.isActive = isActive;
      if (lBanner) adConfig.lBanner = lBanner;

      await adConfig.save();

      return res.json({
        message: 'Ad configuration updated successfully',
        adConfig
      });
    } else {
      // Create new configuration
      // AdConfiguration.brandId is now String (matching Brand._id)
      adConfig = new AdConfiguration({
        userId,
        brandId: resolvedBrandId,
        brandName: brandName || brand.name,
        adPlacement: adPlacement || {},
        targeting: targeting || {},
        playback: playback || {},
        isActive: isActive !== undefined ? isActive : true,
        lBanner: lBanner || { showBannersOnPause: true }
      });

      await adConfig.save();

      return res.status(201).json({
        message: 'Ad configuration created successfully',
        adConfig
      });
    }
  } catch (error) {
    console.error('Create/Update ad config error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Get all ad configurations for the authenticated user
const getAllAdConfigs = async (req, res) => {
  try {
    const userId = req.user.id;
    const { isActive, brandId } = req.query;

    let query = { userId };

    // Filter by active status if provided
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Filter by brand if provided
    if (brandId) {
      query.brandId = brandId;
    }

    const adConfigs = await AdConfiguration.find(query)
      .populate('brandId', 'name description logo')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      count: adConfigs.length,
      adConfigs
    });
  } catch (error) {
    console.error('Get all ad configs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get ad configuration by brand ID
const getAdConfigByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const userId = req.user.id;

    // Verify brand belongs to user
    const brand = await Brand.findOne({ _id: brandId, userId });
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found or does not belong to you' });
    }

    const adConfig = await AdConfiguration.findOne({ brandId })
      .populate('brandId', 'name description logo')
      .populate('userId', 'name email');

    if (!adConfig) {
      return res.status(404).json({ error: 'Ad configuration not found for this brand' });
    }

    res.json({ adConfig });
  } catch (error) {
    console.error('Get ad config by brand error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid brand ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get ad configuration by ID
const getAdConfigById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const adConfig = await AdConfiguration.findOne({ _id: id, userId })
      .populate('brandId', 'name description logo')
      .populate('userId', 'name email');

    if (!adConfig) {
      return res.status(404).json({ error: 'Ad configuration not found' });
    }

    res.json({ adConfig });
  } catch (error) {
    console.error('Get ad config by ID error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid configuration ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update ad placement settings
const updateAdPlacement = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { adPlacement } = req.body;

    if (!adPlacement) {
      return res.status(400).json({ error: 'Ad placement settings are required' });
    }

    const adConfig = await AdConfiguration.findOne({ _id: id, userId });

    if (!adConfig) {
      return res.status(404).json({ error: 'Ad configuration not found' });
    }

    adConfig.adPlacement = { ...adConfig.adPlacement, ...adPlacement };
    await adConfig.save();

    res.json({
      message: 'Ad placement updated successfully',
      adConfig
    });
  } catch (error) {
    console.error('Update ad placement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update targeting settings
const updateTargeting = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { targeting } = req.body;

    if (!targeting) {
      return res.status(400).json({ error: 'Targeting settings are required' });
    }

    const adConfig = await AdConfiguration.findOne({ _id: id, userId });

    if (!adConfig) {
      return res.status(404).json({ error: 'Ad configuration not found' });
    }

    adConfig.targeting = { ...adConfig.targeting, ...targeting };
    await adConfig.save();

    res.json({
      message: 'Targeting settings updated successfully',
      adConfig
    });
  } catch (error) {
    console.error('Update targeting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update playback settings
const updatePlayback = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { playback } = req.body;

    if (!playback) {
      return res.status(400).json({ error: 'Playback settings are required' });
    }

    const adConfig = await AdConfiguration.findOne({ _id: id, userId });

    if (!adConfig) {
      return res.status(404).json({ error: 'Ad configuration not found' });
    }

    adConfig.playback = { ...adConfig.playback, ...playback };
    await adConfig.save();

    res.json({
      message: 'Playback settings updated successfully',
      adConfig
    });
  } catch (error) {
    console.error('Update playback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Toggle active status
const toggleActiveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const adConfig = await AdConfiguration.findOne({ _id: id, userId });

    if (!adConfig) {
      return res.status(404).json({ error: 'Ad configuration not found' });
    }

    adConfig.isActive = !adConfig.isActive;
    await adConfig.save();

    res.json({
      message: `Ad configuration ${adConfig.isActive ? 'activated' : 'deactivated'} successfully`,
      adConfig
    });
  } catch (error) {
    console.error('Toggle active status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete ad configuration
const deleteAdConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const adConfig = await AdConfiguration.findOne({ _id: id, userId });

    if (!adConfig) {
      return res.status(404).json({ error: 'Ad configuration not found' });
    }

    await adConfig.deleteOne();

    res.json({
      message: 'Ad configuration deleted successfully',
      adConfig
    });
  } catch (error) {
    console.error('Delete ad config error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid configuration ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createOrUpdateAdConfig,
  getAllAdConfigs,
  getAdConfigByBrand,
  getAdConfigById,
  updateAdPlacement,
  updateTargeting,
  updatePlayback,
  toggleActiveStatus,
  deleteAdConfig
};
