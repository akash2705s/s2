const Brand = require('../models/Brand');
const User = require('../models/User');

// Create a new brand
const createBrand = async (req, res) => {
  try {
    const { id, name, description, logo, isDefault, settings } = req.body;
    const userId = req.user.id;

    // Validation
    if (!name) {
      return res.status(400).json({ error: 'Brand name is required' });
    }

    // Check if user already has a brand with this name
    const existingBrand = await Brand.findOne({ userId, name });
    if (existingBrand) {
      return res.status(409).json({ error: 'Brand with this name already exists' });
    }

    // Check if this is the first brand for the user - make it default
    const brandCount = await Brand.countDocuments({ userId });
    const shouldBeDefault = brandCount === 0 || isDefault === true;

    // Prepare brand data
    const brandData = {
      name,
      description: description || '',
      logo: logo || '',
      userId,
      isDefault: shouldBeDefault,
      settings: settings || {}
    };

    // If custom ID is provided, use it; otherwise generate one
    if (id) {
      brandData._id = id;
    } else {
      // Auto-generate ID in format: brand_{name}_{timestamp}
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      brandData._id = `brand_${sanitizedName}_${Date.now()}`;
    }

    // Create new brand
    const brand = new Brand(brandData);

    await brand.save();

    // Update user's defaultBrandId if this is the default brand
    if (shouldBeDefault) {
      await User.findByIdAndUpdate(userId, { defaultBrandId: brand._id });
    }

    res.status(201).json({
      message: 'Brand created successfully',
      brand
    });
  } catch (error) {
    console.error('Create brand error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({ 
        error: 'Brand with this ID already exists' 
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all brands for the authenticated user
const getAllBrands = async (req, res) => {
  try {
    const userId = req.user.id;
    const brands = await Brand.findByUser(userId);

    res.json({
      count: brands.length,
      brands
    });
  } catch (error) {
    console.error('Get all brands error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get default brand for the authenticated user
const getDefaultBrand = async (req, res) => {
  try {
    const userId = req.user.id;
    const brand = await Brand.getDefaultBrand(userId);

    if (!brand) {
      return res.status(404).json({ error: 'No default brand found. Please create a brand first.' });
    }

    res.json({ brand });
  } catch (error) {
    console.error('Get default brand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get a single brand by ID
const getBrandById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const brand = await Brand.findOne({ _id: id, userId });

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    res.json({ brand });
  } catch (error) {
    console.error('Get brand by ID error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid brand ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update a brand by ID
const updateBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { name, description, logo, isDefault, settings } = req.body;

    // Find brand and verify ownership
    const brand = await Brand.findOne({ _id: id, userId });

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // Update fields
    if (name !== undefined) brand.name = name;
    if (description !== undefined) brand.description = description;
    if (logo !== undefined) brand.logo = logo;
    if (isDefault !== undefined) brand.isDefault = isDefault;
    if (settings !== undefined) brand.settings = settings;

    await brand.save();

    res.json({
      message: 'Brand updated successfully',
      brand
    });
  } catch (error) {
    console.error('Update brand error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid brand ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Set a brand as default
const setDefaultBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Find brand and verify ownership
    const brand = await Brand.findOne({ _id: id, userId });

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    brand.isDefault = true;
    await brand.save();

    // Update user's defaultBrandId
    await User.findByIdAndUpdate(userId, { defaultBrandId: brand._id });

    res.json({
      message: 'Brand set as default successfully',
      brand
    });
  } catch (error) {
    console.error('Set default brand error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid brand ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete a brand by ID
const deleteBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const brand = await Brand.findOne({ _id: id, userId });

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // Check if it's the default brand and if user has other brands
    if (brand.isDefault) {
      const brandCount = await Brand.countDocuments({ userId });
      if (brandCount > 1) {
        return res.status(400).json({ 
          error: 'Cannot delete default brand. Please set another brand as default first.' 
        });
      }
    }

    await brand.deleteOne();

    res.json({
      message: 'Brand deleted successfully',
      brand
    });
  } catch (error) {
    console.error('Delete brand error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid brand ID' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createBrand,
  getAllBrands,
  getDefaultBrand,
  getBrandById,
  updateBrand,
  setDefaultBrand,
  deleteBrand
};
