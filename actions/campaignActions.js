const Campaign = require('../models/Campaign');
const mongoose = require('mongoose');
const { authenticateToken } = require('../middleware/auth');

// Create a new campaign
const createCampaign = async (req, res) => {
  try {
    const { name, brandId, tvEnvironments } = req.body;
    const userId = req.user.id;

    if (!name || !brandId || !tvEnvironments || !Array.isArray(tvEnvironments) || tvEnvironments.length === 0) {
      return res.status(400).json({ error: 'Campaign name, brandId, and at least one TV environment are required' });
    }

    // Validate TV environments
    const validEnvironments = ['ROKU', 'Fire TV', 'VIZIO', 'Samsung', 'LG'];
    const invalidEnvironments = tvEnvironments.filter(env => !validEnvironments.includes(env));
    if (invalidEnvironments.length > 0) {
      return res.status(400).json({ error: `Invalid TV environments: ${invalidEnvironments.join(', ')}` });
    }

    // Convert userId to ObjectId
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const campaign = new Campaign({
      name,
      brandId,
      userId: userObjectId,
      tvEnvironments,
      status: 'draft',
      adUnits: []
    });

    await campaign.save();
    res.status(201).json({ campaign });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign', details: error.message });
  }
};

// Get all campaigns for a brand
const getCampaignsByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const campaigns = await Campaign.find({ brandId, userId: userObjectId }).sort({ createdAt: -1 });
    res.json({ campaigns });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns', details: error.message });
  }
};

// Get a single campaign
const getCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const campaign = await Campaign.findOne({ _id: campaignId, userId: userObjectId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ campaign });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Failed to fetch campaign', details: error.message });
  }
};

// Update a campaign
const updateCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const { name, tvEnvironments, status, adUnits } = req.body;

    const campaign = await Campaign.findOne({ _id: campaignId, userId: userObjectId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (name) campaign.name = name;
    if (tvEnvironments) {
      const validEnvironments = ['ROKU', 'Fire TV', 'VIZIO', 'Samsung', 'LG'];
      const invalidEnvironments = tvEnvironments.filter(env => !validEnvironments.includes(env));
      if (invalidEnvironments.length > 0) {
        return res.status(400).json({ error: `Invalid TV environments: ${invalidEnvironments.join(', ')}` });
      }
      campaign.tvEnvironments = tvEnvironments;
    }
    if (status) campaign.status = status;
    if (adUnits !== undefined) campaign.adUnits = adUnits;

    await campaign.save();
    res.json({ campaign });
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json({ error: 'Failed to update campaign', details: error.message });
  }
};

// Delete a campaign
const deleteCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const campaign = await Campaign.findOneAndDelete({ _id: campaignId, userId: userObjectId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign', details: error.message });
  }
};

// Add ad unit to campaign
const addAdUnit = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const { elementId, environment, status = 'running' } = req.body;

    console.log('addAdUnit called with:', { campaignId, elementId, environment, status, userId });

    if (!elementId || !environment) {
      return res.status(400).json({ error: 'elementId and environment are required' });
    }

    const campaign = await Campaign.findOne({ _id: campaignId, userId: userObjectId });
    if (!campaign) {
      console.error('Campaign not found:', { campaignId, userId });
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Validate environment is in campaign's TV environments
    if (!campaign.tvEnvironments.includes(environment)) {
      console.error('Environment not in campaign:', { environment, tvEnvironments: campaign.tvEnvironments });
      return res.status(400).json({ error: 'Environment not part of this campaign' });
    }

    // Validate elementId is a string (OverlayElement uses custom string IDs)
    if (!elementId || typeof elementId !== 'string') {
      console.error('Invalid elementId format:', elementId, typeof elementId);
      return res.status(400).json({ error: 'Invalid elementId format. elementId must be a string' });
    }

    console.log('Adding ad unit to campaign:', {
      elementId: elementId,
      environment,
      status,
      currentAdUnitsCount: campaign.adUnits.length
    });

    campaign.adUnits.push({
      elementId: elementId, // Store as string to match OverlayElement's _id format
      environment,
      status
    });

    await campaign.save();
    console.log('Campaign saved with new ad unit. Total adUnits:', campaign.adUnits.length);
    
    // Regenerate campaign VAST to include the new ad unit
    try {
      const { generateCombinedCampaignVast } = require('./vastBrandActions');
      setImmediate(async () => {
        try {
          await generateCombinedCampaignVast(campaignId);
          console.log(`🔄 Campaign VAST regenerated for campaign ${campaignId} after adding ad unit`);
        } catch (vastError) {
          console.warn(`⚠️ Failed to regenerate campaign VAST for ${campaignId}:`, vastError.message);
        }
      });
    } catch (vastError) {
      console.warn('Could not queue VAST regeneration:', vastError.message);
      // Don't fail the request if VAST regeneration fails
    }
    
    res.json({ campaign });
  } catch (error) {
    console.error('Error adding ad unit:', error);
    res.status(500).json({ error: 'Failed to add ad unit', details: error.message });
  }
};

// Update ad unit status
const updateAdUnitStatus = async (req, res) => {
  try {
    const { campaignId, adUnitId } = req.params;
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const { status } = req.body;

    const campaign = await Campaign.findOne({ _id: campaignId, userId: userObjectId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const adUnit = campaign.adUnits.id(adUnitId);
    if (!adUnit) {
      return res.status(404).json({ error: 'Ad unit not found' });
    }

    const oldStatus = adUnit.status;
    adUnit.status = status;
    await campaign.save();
    
    // Regenerate campaign VAST if status changed to/from running
    if (status === 'running' || oldStatus === 'running' || oldStatus !== status) {
      try {
        const { generateCombinedCampaignVast } = require('./vastBrandActions');
        setImmediate(async () => {
          try {
            await generateCombinedCampaignVast(campaignId);
            console.log(`🔄 Campaign VAST regenerated for campaign ${campaignId} after updating ad unit status`);
          } catch (vastError) {
            console.warn(`⚠️ Failed to regenerate campaign VAST for ${campaignId}:`, vastError.message);
          }
        });
      } catch (vastError) {
        console.warn('Could not queue VAST regeneration:', vastError.message);
        // Don't fail the request if VAST regeneration fails
      }
    }
    
    res.json({ campaign });
  } catch (error) {
    console.error('Error updating ad unit status:', error);
    res.status(500).json({ error: 'Failed to update ad unit status', details: error.message });
  }
};

// Remove ad unit from campaign
const removeAdUnit = async (req, res) => {
  try {
    const { campaignId, adUnitId } = req.params;
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const campaign = await Campaign.findOne({ _id: campaignId, userId: userObjectId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Find the ad unit to get its elementId before removing it
    const adUnit = campaign.adUnits.id(adUnitId);
    if (!adUnit) {
      return res.status(404).json({ error: 'Ad unit not found' });
    }

    const elementId = adUnit.elementId?._id || adUnit.elementId?.toString() || adUnit.elementId;

    // Remove ad unit from campaign
    campaign.adUnits.pull(adUnitId);
    await campaign.save();

    // Delete the underlying element if it exists and is not used in any other ad units
    if (elementId) {
      try {
        const OverlayElement = require('../models/OverlayElement');
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        const { s3Client } = require('../config/aws');

        // Check if this elementId is used in any other ad units across all campaigns
        const otherCampaigns = await Campaign.find({
          userId: userObjectId,
          _id: { $ne: campaignId } // Exclude the current campaign
        });

        let isElementUsedElsewhere = false;
        for (const otherCampaign of otherCampaigns) {
          const isUsed = (otherCampaign.adUnits || []).some(au => {
            const auElementId = au.elementId?._id || au.elementId?.toString() || au.elementId;
            return String(auElementId) === String(elementId);
          });
          if (isUsed) {
            isElementUsedElsewhere = true;
            break;
          }
        }

        // Also check if the element is used in other ad units in the same campaign (after removal)
        // Since we already removed the ad unit, we need to check the saved campaign state
        const updatedCampaign = await Campaign.findOne({ _id: campaignId, userId: userObjectId });
        if (updatedCampaign) {
          const isUsedInSameCampaign = (updatedCampaign.adUnits || []).some(au => {
            const auElementId = au.elementId?._id || au.elementId?.toString() || au.elementId;
            return String(auElementId) === String(elementId);
          });
          if (isUsedInSameCampaign) {
            isElementUsedElsewhere = true;
          }
        }

        // Only delete the element if it's not used in any other ad units
        if (!isElementUsedElsewhere) {
          const element = await OverlayElement.findOne({ _id: elementId, userId: userObjectId });
          if (element) {
            // Delete VAST XML from S3 if it exists
            const s3Key = `vast/${elementId}.xml`;
            try {
              await s3Client.send(
                new DeleteObjectCommand({
                  Bucket: process.env.S3_VAST_BUCKET,
                  Key: s3Key
                })
              );
              console.log(`🗑 VAST XML deleted from S3: ${s3Key}`);
            } catch (s3Err) {
              console.warn(`⚠ Could not delete VAST XML (${s3Key}) —`, s3Err.message);
              // Continue with element deletion even if S3 deletion fails
            }

            // Delete the element from database
            await element.deleteOne();
            console.log(`🗑 Element deleted: ${elementId} (not used in any other ad units)`);
          }
        } else {
          console.log(`ℹ Element ${elementId} not deleted - still used in other ad units`);
        }
      } catch (elementErr) {
        console.error('Error deleting element when removing ad unit:', elementErr);
        // Continue even if element deletion fails - ad unit is already removed from campaign
      }
    }

    res.json({ campaign });
  } catch (error) {
    console.error('Error removing ad unit:', error);
    res.status(500).json({ error: 'Failed to remove ad unit', details: error.message });
  }
};

module.exports = {
  createCampaign,
  getCampaignsByBrand,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  addAdUnit,
  updateAdUnitStatus,
  removeAdUnit
};
