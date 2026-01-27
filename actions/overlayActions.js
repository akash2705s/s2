const mongoose = require('mongoose');
const OverlayElement = require('../models/OverlayElement');
const Brand = require('../models/Brand');
const { ROLES } = require('../models/User');
const { DeleteObjectCommand, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require("../config/aws");
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const path = require('path');

// Helper function to parse form data fields (handles both JSON strings and objects)
const parseFormField = (field) => {
  console.log('Parsing field - Type:', typeof field, 'Value:', field);
  if (!field) return {};
  if (typeof field === 'object') return field;
  try {
    const parsed = JSON.parse(field);
    console.log('Parsed successfully:', parsed);
    return parsed;
  } catch (error) {
    console.log('Parse error:', error.message);
    return {};
  }
};

// Helper function to download image from URL
const downloadImage = (url) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = response.headers['content-type'] || 'image/jpeg';
        resolve({ buffer, contentType });
      });
    }).on('error', reject);
  });
};

// Helper function to compress image with Sharp - more aggressive lossless compression
const compressImage = async (buffer, mimetype) => {
  const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (!imageTypes.includes(mimetype)) {
    return buffer; // Return original if not an image
  }

  try {
    let sharpInstance = sharp(buffer);
    const originalSize = buffer.length;

    // Get image metadata to determine best compression strategy
    const metadata = await sharpInstance.metadata();
    const isLargeImage = originalSize > 2 * 1024 * 1024; // > 2MB

    // Apply format-specific compression with aggressive settings
    if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
      // More aggressive JPEG compression
      sharpInstance = sharpInstance.jpeg({
        quality: 82, // Lowered from 85 for better compression
        mozjpeg: true, // Use mozjpeg for better compression
        progressive: true, // Progressive JPEG
        optimizeScans: true, // Optimize scans for better compression
        trellisQuantisation: true, // Trellis quantization for better compression
        overshootDeringing: true, // Overshoot deringing
        optimizeCoding: true // Optimize Huffman coding
      });
    } else if (mimetype === 'image/png') {
      // PNG compression - already at max, but try converting large PNGs to WebP
      if (isLargeImage && metadata.hasAlpha) {
        // For large PNGs with transparency, try WebP lossless
        sharpInstance = sharpInstance.webp({
          lossless: true,
          effort: 6, // Maximum effort for best compression
          quality: 100 // Lossless mode
        });
      } else if (isLargeImage) {
        // For large PNGs without transparency, convert to optimized JPEG
        sharpInstance = sharpInstance.jpeg({
          quality: 82,
          mozjpeg: true,
          progressive: true,
          optimizeScans: true,
          trellisQuantisation: true,
          overshootDeringing: true,
          optimizeCoding: true
        });
      } else {
        // Small PNGs - use maximum PNG compression
        sharpInstance = sharpInstance.png({
          compressionLevel: 9, // Maximum compression
          adaptiveFiltering: true, // Adaptive filtering
          palette: true, // Try palette mode if possible
          quality: 100 // Lossless
        });
      }
    } else if (mimetype === 'image/webp') {
      // WebP compression - more aggressive
      sharpInstance = sharpInstance.webp({
        quality: 82, // Lowered from 85
        effort: 6, // Maximum effort (0-6)
        lossless: false,
        smartSubsample: true, // Smart subsampling
        nearLossless: false
      });
    }

    const compressed = await sharpInstance.toBuffer();
    const compressedSize = compressed.length;
    const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2);

    console.log(`Image compression: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressedSize / 1024 / 1024).toFixed(2)}MB (${compressionRatio}% reduction)`);

    // If compression didn't help much, try alternative strategies for large images
    if (isLargeImage && compressedSize > originalSize * 0.95) {
      console.log('Trying alternative compression strategy for large image...');

      // Try multiple strategies and pick the best one
      const strategies = [];

      // Strategy 1: WebP lossless (best for PNGs with transparency)
      if (mimetype === 'image/png' || mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
        try {
          const webpLossless = await sharp(buffer)
            .webp({
              lossless: true,
              effort: 6,
              quality: 100
            })
            .toBuffer();

          if (webpLossless.length < compressed.length) {
            strategies.push({ buffer: webpLossless, name: 'WebP Lossless', size: webpLossless.length });
          }
        } catch (webpError) {
          console.log('WebP lossless conversion failed');
        }
      }

      // Strategy 2: WebP high quality (for JPEGs)
      if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
        try {
          const webpHigh = await sharp(buffer)
            .webp({
              quality: 80,
              effort: 6,
              smartSubsample: true
            })
            .toBuffer();

          if (webpHigh.length < compressed.length) {
            strategies.push({ buffer: webpHigh, name: 'WebP High Quality', size: webpHigh.length });
          }
        } catch (webpError) {
          console.log('WebP high quality conversion failed');
        }
      }

      // Strategy 3: More aggressive JPEG (for JPEGs)
      if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
        try {
          const jpegAggressive = await sharp(buffer)
            .jpeg({
              quality: 80,
              mozjpeg: true,
              progressive: true,
              optimizeScans: true,
              trellisQuantisation: true,
              overshootDeringing: true,
              optimizeCoding: true
            })
            .toBuffer();

          if (jpegAggressive.length < compressed.length) {
            strategies.push({ buffer: jpegAggressive, name: 'JPEG Aggressive', size: jpegAggressive.length });
          }
        } catch (jpegError) {
          console.log('Aggressive JPEG compression failed');
        }
      }

      // Strategy 4: AVIF (if supported, best compression)
      try {
        const avifBuffer = await sharp(buffer)
          .avif({
            quality: 80,
            effort: 6
          })
          .toBuffer();

        if (avifBuffer.length < compressed.length) {
          strategies.push({ buffer: avifBuffer, name: 'AVIF', size: avifBuffer.length });
        }
      } catch (avifError) {
        // AVIF might not be supported, skip silently
      }

      // Pick the best strategy (smallest file)
      if (strategies.length > 0) {
        strategies.sort((a, b) => a.size - b.size);
        const best = strategies[0];
        console.log(`Best compression strategy: ${best.name} - ${(best.size / 1024 / 1024).toFixed(2)}MB (${((originalSize - best.size) / originalSize * 100).toFixed(2)}% reduction)`);
        return best.buffer;
      }
    }

    return compressed;
  } catch (error) {
    console.error('Error compressing image:', error);
    return buffer; // Return original on error
  }
};

// Helper function to convert S3 key to CDN URL
const getCdnUrl = (s3Key) => {
  // CDN format: https://images.ads.canvas.space/<path-in-s3>
  return `https://images.ads.canvas.space/${s3Key}`;
};

// Helper function to apply default configuration for full-page-ad poll elements
// Restructures to match corner-banner layers format
const applyDefaultPollConfig = (config, elemType) => {
  if (elemType === 'full-page-ad' && config?.content?.type === 'poll') {
    // Default values
    const defaultHeroImage = {
      url: 'https://raw.githubusercontent.com/akash2705s/img2/main/pop.mp4',
      uploadedMedia: null
    };
    const defaultQrCode = {
      text: 'Save 15%',
      subtext: 'sitewide',
      branding: 'Code: 15CUPID',
      url: 'https://raw.githubusercontent.com/akash2705s/img2/main/pf1.png',
      uploadedMedia: null,
      duration: 20,
      qrDisplayDurationSeconds: 20
    };
    const defaultQrHeroImage = {
      url: 'https://raw.githubusercontent.com/akash2705s/img2/main/tpf.png',
      uploadedMedia: null
    };

    // Ensure content structure exists
    if (!config.content) {
      config.content = {};
    }

    // Check if already using layers structure (corner-banner format)
    const hasLayers = Array.isArray(config.content.layers);

    if (!hasLayers) {
      // Migrate from old structure (content.poll) to new structure (content.layers)
      const poll = config.content.poll || {};

      // Create poll layer (layer 0)
      const pollLayer = {
        type: 'poll',
        heroImage: poll.heroImage && poll.heroImage.url
          ? poll.heroImage
          : defaultHeroImage,
        pollHeading: poll.heading || '',
        pollQuestion: poll.question || '',
        pollOptions: poll.options || ['', ''],
        pollButtons: poll.pollButtons || (poll.options ? poll.options.map((opt, idx) => ({
          text: opt || `Option ${idx + 1}`,
          targetLayer: 1
        })) : []),
        leftButtonText: poll.leftButtonText || poll.options?.[0] || '',
        rightButtonText: poll.rightButtonText || poll.options?.[1] || '',
        button1Text: poll.button1Text || poll.options?.[0] || '',
        button2Text: poll.button2Text || poll.options?.[1] || '',
        button1TargetLayer: 1,
        leftTargetLayer: 1,
        button2TargetLayer: 1,
        rightTargetLayer: 1
      };

      // Create QR layer (layer 1)
      const qrLayer = {
        type: 'qr',
        heroImage: poll.qrBackgroundImage
          ? { url: poll.qrBackgroundImage, uploadedMedia: poll.qrBackgroundImageUploaded || null }
          : defaultQrHeroImage,
        qrCode: poll.qrCode && poll.qrCode.url
          ? poll.qrCode
          : defaultQrCode,
        sublayerNumber: 1
      };

      // Set up layers array
      config.content.layers = [pollLayer, qrLayer];

      // Remove old poll structure
      delete config.content.poll;
    } else {
      // Already using layers structure - ensure defaults are applied
      // Find poll layer (type: 'poll')
      const pollLayer = config.content.layers.find(layer => layer.type === 'poll');
      if (pollLayer) {
        // Apply heroImage defaults if missing
        if (!pollLayer.heroImage || !pollLayer.heroImage.url) {
          pollLayer.heroImage = defaultHeroImage;
        }
      } else {
        // No poll layer found, create one
        config.content.layers.unshift({
          type: 'poll',
          heroImage: defaultHeroImage,
          pollHeading: '',
          pollQuestion: '',
          pollOptions: ['', ''],
          pollButtons: [],
          leftButtonText: '',
          rightButtonText: '',
          button1Text: '',
          button2Text: '',
          button1TargetLayer: 1,
          leftTargetLayer: 1,
          button2TargetLayer: 1,
          rightTargetLayer: 1
        });
      }

      // Find QR layers and ensure defaults
      const qrLayers = config.content.layers.filter(layer => layer.type === 'qr');
      if (qrLayers.length === 0) {
        // No QR layer found, create one
        config.content.layers.push({
          type: 'qr',
          heroImage: defaultQrHeroImage,
          qrCode: defaultQrCode,
          sublayerNumber: 1
        });
      } else {
        // Ensure QR layers have defaults
        qrLayers.forEach((qrLayer, idx) => {
          if (!qrLayer.heroImage || !qrLayer.heroImage.url) {
            qrLayer.heroImage = defaultQrHeroImage;
          }
          if (!qrLayer.qrCode) {
            qrLayer.qrCode = defaultQrCode;
          } else {
            if (!qrLayer.qrCode.text) qrLayer.qrCode.text = defaultQrCode.text;
            if (!qrLayer.qrCode.subtext) qrLayer.qrCode.subtext = defaultQrCode.subtext;
            if (!qrLayer.qrCode.branding) qrLayer.qrCode.branding = defaultQrCode.branding;
            if (!qrLayer.qrCode.url) qrLayer.qrCode.url = defaultQrCode.url;
            if (qrLayer.qrCode.uploadedMedia === undefined) {
              qrLayer.qrCode.uploadedMedia = defaultQrCode.uploadedMedia;
            }
            if (!qrLayer.qrCode.duration && qrLayer.qrCode.duration !== 0) {
              qrLayer.qrCode.duration = defaultQrCode.duration;
            }
            if (!qrLayer.qrCode.qrDisplayDurationSeconds && qrLayer.qrCode.qrDisplayDurationSeconds !== 0) {
              qrLayer.qrCode.qrDisplayDurationSeconds = defaultQrCode.qrDisplayDurationSeconds;
            }
          }
          if (!qrLayer.sublayerNumber) {
            qrLayer.sublayerNumber = idx + 1;
          }
        });
      }
    }

    // Ensure uploadedFiles array exists (even if empty)
    if (!config.uploadedFiles) {
      config.uploadedFiles = [];
    }

    // Ensure parentAdUnit exists
    if (!config.parentAdUnit) {
      config.parentAdUnit = {
        unitType: 'parent',
        isTagged: true
      };
    }
  }
  return config;
};

// Helper function to upload compressed image to S3
const uploadImageToS3 = async (buffer, contentType, originalUrl) => {
  try {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(new URL(originalUrl).pathname) || '.jpg';
    const key = `uploads/compressed-${uniqueSuffix}${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: {
        originalUrl: originalUrl
      }
    });

    await s3Client.send(command);

    // Generate presigned URL
    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key
    });

    const presignedUrl = await getSignedUrl(s3Client, getObjectCommand, {
      expiresIn: 604800 // 7 days (maximum allowed by AWS)
    });

    return presignedUrl;
  } catch (error) {
    console.error('Error uploading image to S3:', error);
    throw error;
  }
};

// Helper function to process image URL: download, compress, upload to S3
const processImageUrl = async (url) => {
  try {
    // Skip if already S3 URL or data URL
    if (url.startsWith('data:') || url.includes('s3.amazonaws.com') || url.includes('s3.') && url.includes('.amazonaws.com')) {
      return url; // Already processed or S3 URL
    }

    // Skip if not a valid HTTP/HTTPS URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return url;
    }

    console.log(`Processing image URL: ${url}`);

    // Download image
    const { buffer, contentType } = await downloadImage(url);

    // Check if it's an image
    if (!contentType.startsWith('image/')) {
      console.log(`Skipping non-image URL: ${url}`);
      return url;
    }

    // Compress image
    const compressedBuffer = await compressImage(buffer, contentType);

    // Upload to S3
    const s3Url = await uploadImageToS3(compressedBuffer, contentType, url);

    console.log(`Image processed and uploaded: ${url} -> ${s3Url}`);
    return s3Url;
  } catch (error) {
    console.error(`Error processing image URL ${url}:`, error);
    return url; // Return original URL on error
  }
};

// Helper function to recursively find and process image URLs in configuration
const processImageUrlsInConfig = async (config) => {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const processed = Array.isArray(config) ? [...config] : { ...config };

  for (const key in processed) {
    if (processed.hasOwnProperty(key)) {
      const value = processed[key];

      // Check if this is an image URL field
      if (typeof value === 'string' && value.trim() !== '') {
        // Check if it's a URL (http/https) and likely an image
        const isUrl = value.startsWith('http://') || value.startsWith('https://');
        const isImageField = key === 'url' ||
          key === 'imageUrl' ||
          key === 'mediaUrl' ||
          key === 'backgroundImage' ||
          key === 'pollBackgroundImage' ||
          key === 'fallbackImageUrl' ||
          key === 'cornerImage' ||
          (key.toLowerCase().includes('url') && isUrl) ||
          (key.toLowerCase().includes('image') && isUrl);

        if (isUrl && isImageField && !value.startsWith('data:') && !value.includes('s3.amazonaws.com')) {
          // Process image URL: download, compress, upload to S3
          processed[key] = await processImageUrl(value);
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively process nested objects and arrays
        processed[key] = await processImageUrlsInConfig(value);
      }
    }
  }

  return processed;
};

const deleteElement = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // ✔ 1) Check element ownership
    const element = await OverlayElement.findOne({ _id: id, userId });
    if (!element) {
      return res.status(404).json({ error: 'Overlay element not found' });
    }

    // ✔ 2) Delete VAST XML from S3 (only if exists)
    const s3Key = `vast/${id}.xml`;

    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_VAST_BUCKET, // must be defined in .env
          Key: s3Key
        })
      );
      console.log(`🗑 VAST XML deleted from S3: ${s3Key}`);
    } catch (err) {
      console.warn(`⚠ Could not delete VAST XML (${s3Key}) —`, err.message);
    }

    // ❓ Optional: Delete uploaded assets (image/video) stored in S3?
    // 👉 We will ask you before enabling this feature.

    // ✔ 3) Delete DB document
    await element.deleteOne();

    res.json({
      message: 'Overlay element and VAST XML deleted successfully',
      elementId: id
    });

  } catch (error) {
    console.error('Delete element error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid element ID' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
};

// Create a new overlay element
const createElement = async (req, res) => {
  try {
    console.log('=== CREATE ELEMENT START ===');
    console.log('req.body:', req.body);
    console.log('req.body.meta type:', typeof req.body.meta);
    console.log('req.user from JWT:', req.user);

    const metaData = JSON.parse(req.body.meta);
    const brandId = metaData.brandId;
    const userId = req.user.id;

    console.log('Parsed metaData:', metaData);
    console.log('Extracted brandId:', brandId);
    console.log('User ID from token:', userId);

    // Validation
    if (!brandId) {
      console.log('ERROR: Brand ID is missing');
      return res.status(400).json({ error: 'Brand ID is required' });
    }

    // Convert userId to ObjectId for MongoDB query
    console.log('=== ID NORMALIZATION ===');
    console.log('Original brandId (string):', brandId, 'Type:', typeof brandId);
    console.log('Original userId (string):', userId, 'Type:', typeof userId);

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const normalizedBrandId = typeof brandId === 'string' ? brandId : String(brandId);

    console.log('Normalized brandId:', normalizedBrandId);
    console.log('Converted userObjectId:', userObjectId);

    // Verify brand exists and belongs to user
    console.log('=== BRAND LOOKUP ===');
    console.log('Looking up brand (using raw MongoDB to bypass Mongoose schema issues)');

    // Use raw MongoDB query because Brand schema has issues with Mongoose queries
    const brandsCollection = mongoose.connection.db.collection('brands');
    const brandDoc = await brandsCollection.findOne({ _id: normalizedBrandId, userId: userObjectId });
    console.log('Brand found:', brandDoc ? 'YES - ' + brandDoc.name : 'NO');

    if (!brandDoc) {
      console.log('ERROR: Brand not found or does not belong to user');
      return res.status(404).json({ error: 'Brand not found or does not belong to you' });
    }

    console.log('Brand validated successfully:', brandDoc.name);

    // Parse meta and configuration from form data (can be JSON strings)
    const meta = parseFormField(req.body.meta);
    let configuration = parseFormField(req.body.configuration);

    console.log('=== CREATE ELEMENT DEBUG ===');
    console.log('Body keys:', Object.keys(req.body));
    console.log('Files received:', req.files?.length || 0);
    console.log('Files details:', req.files);
    console.log('Configuration before:', JSON.stringify(configuration, null, 2));

    // Handle uploaded files if present
    if (req.files && req.files.length > 0) {
      const uploadedFiles = req.files.map(file => {
        console.log('Processing file:', JSON.stringify(file, null, 2));

        // Check if this is an S3 upload (has location or key property)
        if (file.location) {
          // S3 upload with location
          return {
            filename: file.key ? file.key.split('/').pop() : file.filename,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            key: file.key,
            bucket: file.bucket,
            location: file.location,
            url: file.location
          };
        } else if (file.key) {
          // S3 upload without location (build URL manually)
          const s3Url = `https://${file.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.key}`;
          return {
            filename: file.key.split('/').pop(),
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            key: file.key,
            bucket: file.bucket,
            location: s3Url,
            url: s3Url
          };
        } else {
          // Local storage fallback (shouldn't happen but just in case)
          return {
            filename: file.filename,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            path: `/uploads/${file.filename}`,
            url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`
          };
        }
      });

      console.log('Mapped uploaded files:', uploadedFiles);

      // Replace placeholder file references in configuration with actual uploaded files
      // This handles cases where frontend sends placeholders like File_Upload_0
      if (configuration && typeof configuration === 'object') {
        // Recursively replace file placeholders
        replaceFilePlaceholders(configuration, uploadedFiles);
        console.log('Configuration after replacement:', JSON.stringify(configuration, null, 2));
      }

      // Also store files in a files array for reference
      if (!configuration.uploadedFiles) {
        configuration.uploadedFiles = uploadedFiles;
      }
    }

    console.log('=== END DEBUG ===');

    // Process image URLs in configuration: download, compress, and upload to S3
    if (configuration && typeof configuration === 'object') {
      console.log('Processing image URLs in configuration...');
      configuration = await processImageUrlsInConfig(configuration);
      console.log('Image URLs processed successfully');
    }

    // Apply default poll configuration for full-page-ad elements
    const elemType = meta?.elementType || meta?.type;
    if (configuration && typeof configuration === 'object') {
      configuration = applyDefaultPollConfig(configuration, elemType);
      console.log('Applied default poll config for full-page-ad:', elemType === 'full-page-ad');
    }

    // Create new overlay element with userId for direct ownership tracking
    // Support custom _id from frontend if provided
    // userObjectId already declared above

    const elementData = {
      userId: userObjectId,
      brandId: normalizedBrandId,
      meta,
      configuration
    };

    // If meta contains an id field, use it as _id
    if (meta && meta.id) {
      elementData._id = meta.id;
    }

    const element = new OverlayElement(elementData);

    await element.save();

    res.status(201).json({
      message: 'Overlay element created successfully',
      element
    });
  } catch (error) {
    console.error('=== CREATE ELEMENT ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error code:', error.code);
    console.error('===========================');

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Element with this ID already exists. Use update instead.'
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to replace file upload placeholders with actual URLs
const replaceFilePlaceholders = (obj, files) => {
  if (!obj || typeof obj !== 'object') return;

  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      // Check for various file placeholder patterns:
      // File_Upload_0, FILE_UPLOAD_0, __FILE_UPLOAD_0__, __FILE_UPLOAD_0_, __FILE_UPLOAD_0
      const match = obj[key].match(/^_*File_Upload_(\d+)_*$/i) ||
        obj[key].match(/^_*FILE_UPLOAD_(\d+)_*$/);

      if (match) {
        const index = parseInt(match[1]);
        console.log(`Found placeholder: "${obj[key]}" at key: "${key}", index: ${index}`);
        if (files[index]) {
          // Replace with the actual file URL
          obj[key] = files[index].url;
          console.log(`Replaced with: ${obj[key]}`);
        } else {
          console.log(`No file found at index ${index}, total files: ${files.length}`);
        }
      }
    } else if (Array.isArray(obj[key])) {
      // Handle arrays
      obj[key].forEach(item => replaceFilePlaceholders(item, files));
    } else if (typeof obj[key] === 'object') {
      // Recursively check nested objects
      replaceFilePlaceholders(obj[key], files);
    }
  }
};

// Get all overlay elements (optionally filtered by brand)
const getAllElements = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email; // Get user email from JWT
    const userRole = req.user.role;
    const { brandId, campaignId } = req.query;

    // 🔹 SUPERADMIN: can see ALL elements across all users (optionally filtered by brand)
    if (userRole === ROLES.SUPERADMIN) {
      const query = {};

      if (brandId) {
        const normalizedBrandId = typeof brandId === 'string' ? brandId : String(brandId);
        query.brandId = normalizedBrandId;
      }

      let elementIds = null;
      if (campaignId) {
        const normalizedCampaignId = typeof campaignId === 'string' ? campaignId : String(campaignId);
        const campaignObjectId = new mongoose.Types.ObjectId(normalizedCampaignId);
        const campaign = await Campaign.findById(campaignObjectId);
        if (!campaign) {
          return res.status(404).json({ error: 'Campaign not found' });
        }
        elementIds = campaign.adUnits.map(au => au.elementId);
        if (elementIds.length === 0) {
          return res.json({
            count: 0,
            elements: []
          });
        }
        query._id = { $in: elementIds };
      }

      const allElements = await OverlayElement.find(query)
        .populate('brandId', 'name description')
        .populate('userId', 'name email')
        .sort({ createdAt: -1 });

      const elementsWithFlags = allElements.map(el => {
        const elObj = el.toObject();
        elObj.isReference = false;
        elObj.canEdit = true;
        elObj.canDelete = true;
        // Keep owner info for display/debug in UI if needed
        elObj.servedFromOwner = el.userId?.email || 'unknown';
        return elObj;
      });

      return res.json({
        count: elementsWithFlags.length,
        elements: elementsWithFlags
      });
    }

    // 🔹 Non-SuperAdmin: only own + shared elements

    // Convert userId to ObjectId
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Query for owned elements
    let ownedQuery = { userId: userObjectId };

    // Query for shared elements (shallow references)
    let sharedQuery = { sharedWith: userEmail || '' };

    let normalizedBrandId;
    if (brandId) {
      normalizedBrandId = typeof brandId === 'string' ? brandId : String(brandId);

      // Verify brand belongs to user using raw MongoDB
      const brandsCollection = mongoose.connection.db.collection('brands');
      const brandDoc = await brandsCollection.findOne({ _id: normalizedBrandId, userId: userObjectId });
      if (!brandDoc) {
        return res.status(404).json({ error: 'Brand not found or does not belong to you' });
      }
      ownedQuery.brandId = normalizedBrandId;
      // Note: Shared banners may have different brandId, so we don't filter sharedQuery by brandId
    }

    let elementIds = null;
    if (campaignId) {
      const normalizedCampaignId = typeof campaignId === 'string' ? campaignId : String(campaignId);
      const campaignObjectId = new mongoose.Types.ObjectId(normalizedCampaignId);

      // Verify campaign belongs to user using raw MongoDB
      const campaignsCollection = mongoose.connection.db.collection('campaigns');
      const campaignDoc = await campaignsCollection.findOne({ _id: campaignObjectId, userId: userObjectId });
      if (!campaignDoc) {
        return res.status(404).json({ error: 'Campaign not found or does not belong to you' });
      }

      // If brandId is also provided, verify the campaign belongs to the specified brand
      if (brandId && campaignDoc.brandId !== normalizedBrandId) {
        return res.status(404).json({ error: 'Campaign does not belong to the specified brand' });
      }

      elementIds = campaignDoc.adUnits.map(au => au.elementId);
      if (elementIds.length > 0) {
        ownedQuery._id = { $in: elementIds };
        sharedQuery._id = { $in: elementIds };
      } else {
        return res.json({
          count: 0,
          elements: []
        });
      }
    }

    // Fetch owned elements
    const ownedElements = await OverlayElement.find(ownedQuery)
      .populate('brandId', 'name description')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    // Fetch shared elements (shallow references) - only if userEmail exists
    const sharedElements = userEmail
      ? await OverlayElement.find(sharedQuery)
        .populate('brandId', 'name description')
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
      : [];

    // Mark owned elements
    const ownedWithFlags = ownedElements.map(el => {
      const elObj = el.toObject();
      elObj.isReference = false;
      elObj.canEdit = true;
      elObj.canDelete = true;
      return elObj;
    });

    // Mark shared elements as references (non-editable)
    const sharedWithFlags = sharedElements.map(el => {
      const elObj = el.toObject();
      elObj.isReference = true;
      elObj.canEdit = false;
      elObj.canDelete = false;
      elObj.servedFromOwner = el.userId?.email || 'unknown';
      elObj.requestedBy = userEmail;
      elObj.copyType = 'SHALLOW_REFERENCE';
      return elObj;
    });

    // Combine both arrays
    const allElements = [...ownedWithFlags, ...sharedWithFlags];

    res.json({
      count: allElements.length,
      elements: allElements
    });
  } catch (error) {
    console.error('Get all elements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all overlay elements (optionally filtered by brand)
const getAllElements_old = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email; // Get user email from JWT
    const userRole = req.user.role;
    const { brandId, campaignId } = req.query;

    // 🔹 SUPERADMIN: can see ALL elements across all users (optionally filtered by brand)
    if (userRole === ROLES.SUPERADMIN) {
      const query = {};
      let normalizedBrandId;

      if (brandId) {
        normalizedBrandId = typeof brandId === 'string' ? brandId : String(brandId);
        query.brandId = normalizedBrandId;
      }

      if (campaignId) {
        normalizedCampaignId = typeof campaignId === 'string' ? campaignId : String(campaignId);
        query.campaignId = normalizedCampaignId;
      }

      const allElements = await OverlayElement.find(query)
        .populate('brandId', 'name description')
        .populate('userId', 'name email')
        .sort({ createdAt: -1 });

      const elementsWithFlags = allElements.map(el => {
        const elObj = el.toObject();
        elObj.isReference = false;
        elObj.canEdit = true;
        elObj.canDelete = true;
        // Keep owner info for display/debug in UI if needed
        elObj.servedFromOwner = el.userId?.email || 'unknown';
        return elObj;
      });

      return res.json({
        count: elementsWithFlags.length,
        elements: elementsWithFlags
      });
    }

    // 🔹 Non-SuperAdmin: only own + shared elements

    // Convert userId to ObjectId
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Query for owned elements
    let ownedQuery = { userId: userObjectId };

    // Query for shared elements (shallow references)
    let sharedQuery = { sharedWith: userEmail || '' };

    if (brandId) {
      const normalizedBrandId = typeof brandId === 'string' ? brandId : String(brandId);

      // Verify brand belongs to user using raw MongoDB
      const brandsCollection = mongoose.connection.db.collection('brands');
      const brandDoc = await brandsCollection.findOne({ _id: normalizedBrandId, userId: userObjectId });
      if (!brandDoc) {
        return res.status(404).json({ error: 'Brand not found or does not belong to you' });
      }
      ownedQuery.brandId = normalizedBrandId;
      // Note: Shared banners may have different brandId, so we don't filter sharedQuery by brandId
    }

    // Handle campaignId filter if provided
    if (campaignId) {
      const normalizedCampaignId = typeof campaignId === 'string' ? campaignId : String(campaignId);
      const campaignObjectId = new mongoose.Types.ObjectId(normalizedCampaignId);

      // Verify campaign belongs to user using raw MongoDB
      const campaignsCollection = mongoose.connection.db.collection('campaigns');
      const campaignDoc = await campaignsCollection.findOne({ _id: campaignObjectId, userId: userObjectId });
      if (!campaignDoc) {
        return res.status(404).json({ error: 'Campaign not found or does not belong to you' });
      }

      // If brandId is also provided, verify the campaign belongs to the specified brand
      if (brandId && campaignDoc.brandId.toString() !== normalizedBrandId) {
        return res.status(404).json({ error: 'Campaign does not belong to the specified brand' });
      }

      ownedQuery.campaignId = normalizedCampaignId;
      // Note: Shared elements may have different campaignId, so we don't filter sharedQuery by campaignId
    }

    // Fetch owned elements
    const ownedElements = await OverlayElement.find(ownedQuery)
      .populate('brandId', 'name description')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    // Fetch shared elements (shallow references) - only if userEmail exists
    const sharedElements = userEmail
      ? await OverlayElement.find(sharedQuery)
        .populate('brandId', 'name description')
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
      : [];

    // Mark owned elements
    const ownedWithFlags = ownedElements.map(el => {
      const elObj = el.toObject();
      elObj.isReference = false;
      elObj.canEdit = true;
      elObj.canDelete = true;
      return elObj;
    });

    // Mark shared elements as references (non-editable)
    const sharedWithFlags = sharedElements.map(el => {
      const elObj = el.toObject();
      elObj.isReference = true;
      elObj.canEdit = false;
      elObj.canDelete = false;
      elObj.servedFromOwner = el.userId?.email || 'unknown';
      elObj.requestedBy = userEmail;
      elObj.copyType = 'SHALLOW_REFERENCE';
      return elObj;
    });

    // Combine both arrays
    const allElements = [...ownedWithFlags, ...sharedWithFlags];

    res.json({
      count: allElements.length,
      elements: allElements
    });
  } catch (error) {
    console.error('Get all elements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get a single overlay element by ID
const getElementById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Convert userId to ObjectId
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Find element and verify ownership directly through userId
    const element = await OverlayElement.findOne({ _id: id, userId: userObjectId })
      .populate('brandId', 'name description')
      .populate('userId', 'name email');

    if (!element) {
      return res.status(404).json({ error: 'Overlay element not found' });
    }

    res.json({ element });
  } catch (error) {
    console.error('Get element by ID error:', error);

    // Handle invalid MongoDB ObjectId
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid element ID' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update an overlay element by ID (or create if doesn't exist)
const updateElement = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Convert userId to ObjectId
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Parse meta and configuration from form data
    const updateData = {};
    if (req.body.meta !== undefined) {
      updateData.meta = parseFormField(req.body.meta);
    }
    if (req.body.configuration !== undefined) {
      updateData.configuration = parseFormField(req.body.configuration);
    }

    console.log('=== UPDATE ELEMENT DEBUG ===');
    console.log('Element ID:', id);
    console.log('Body keys:', Object.keys(req.body));
    console.log('Files received:', req.files?.length || 0);
    console.log('Files details:', req.files);
    console.log('Configuration before:', JSON.stringify(updateData.configuration, null, 2));

    // Extract brandId from meta if provided
    const brandId = updateData.meta?.brandId;

    // If brandId is provided, verify it belongs to user
    if (brandId) {
      const normalizedBrandId = typeof brandId === 'string' ? brandId : String(brandId);
      const brandsCollection = mongoose.connection.db.collection('brands');
      const brandDoc = await brandsCollection.findOne({ _id: normalizedBrandId, userId: userObjectId });
      if (!brandDoc) {
        return res.status(404).json({ error: 'Brand not found or does not belong to you' });
      }
    }

    // Try to find existing element
    let element = await OverlayElement.findOne({ _id: id, userId: userObjectId });

    // Handle uploaded files if present
    if (req.files && req.files.length > 0) {
      const uploadedFiles = req.files.map(file => {
        console.log('Processing file:', JSON.stringify(file, null, 2));

        // Check if this is an S3 upload (has location or key property)
        if (file.location) {
          // S3 upload with location
          return {
            filename: file.key ? file.key.split('/').pop() : file.filename,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            key: file.key,
            bucket: file.bucket,
            location: file.location,
            url: file.location
          };
        } else if (file.key) {
          // S3 upload without location (build URL manually)
          const s3Url = `https://${file.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.key}`;
          return {
            filename: file.key.split('/').pop(),
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            key: file.key,
            bucket: file.bucket,
            location: s3Url,
            url: s3Url
          };
        } else {
          // Local storage fallback (shouldn't happen but just in case)
          return {
            filename: file.filename,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            path: `/uploads/${file.filename}`,
            url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`
          };
        }
      });

      console.log('Mapped uploaded files:', uploadedFiles);

      // Merge with existing configuration
      const currentConfig = updateData.configuration || element.configuration || {};
      updateData.configuration = {
        ...currentConfig
      };

      console.log('Configuration after merge:', JSON.stringify(updateData.configuration, null, 2));

      // Replace placeholder file references with actual uploaded files
      replaceFilePlaceholders(updateData.configuration, uploadedFiles);

      console.log('Configuration after replacement:', JSON.stringify(updateData.configuration, null, 2));

      // Store uploaded files reference
      if (!updateData.configuration.uploadedFiles) {
        updateData.configuration.uploadedFiles = uploadedFiles;
      }
    } else {
      // If no files uploaded, ensure we have the configuration to process
      if (!updateData.configuration && element) {
        updateData.configuration = element.configuration || {};
      }
    }

    console.log('=== END UPDATE DEBUG ===');

    // Process image URLs in configuration: download, compress, and upload to S3
    // This happens on every save, whether files were uploaded or not
    const configToProcess = updateData.configuration || (element ? element.configuration : {});
    if (configToProcess && typeof configToProcess === 'object') {
      console.log('Processing image URLs in configuration...');
      updateData.configuration = await processImageUrlsInConfig(configToProcess);
      console.log('Image URLs processed successfully');
    }

    // Apply default poll configuration for full-page-ad elements
    const elemType = updateData.meta?.elementType || element?.meta?.elementType || updateData.meta?.type || element?.meta?.type;
    if (updateData.configuration && typeof updateData.configuration === 'object') {
      updateData.configuration = applyDefaultPollConfig(updateData.configuration, elemType);
      console.log('Applied default poll config for full-page-ad:', elemType === 'full-page-ad');
    }

    // Prepare data for upsert
    const elementData = {
      _id: id,
      userId: userObjectId,
      ...updateData
    };

    // Add brandId if provided (convert to ObjectId for consistency)
    if (brandId) {
      elementData.brandId = typeof brandId === 'string' ? brandId : String(brandId);
    } else if (element && element.brandId) {
      elementData.brandId = element.brandId;
    }

    // Use findOneAndUpdate with upsert to create if doesn't exist
    const updatedElement = await OverlayElement.findOneAndUpdate(
      { _id: id, userId: userObjectId },
      elementData,
      {
        new: true,
        upsert: true,
        runValidators: false, // Disable validators for upsert
        setDefaultsOnInsert: true
      }
    )
      .populate('brandId', 'name description')
      .populate('userId', 'name email');

    // Regenerate VAST XML when element is updated (to reflect changes in live)
    if (element) {
      try {
        const { generateVastXml } = require('./vastActions');
        // Force regenerate VAST in background (don't wait for it)
        const vastReq = {
          params: { elementId: id },
          query: { forceGenerate: 'true' }
        };
        const vastRes = {
          set: () => vastRes,
          send: () => { },
          status: () => ({ json: () => { } })
        };
        // Regenerate VAST asynchronously
        setImmediate(() => {
          generateVastXml(vastReq, vastRes).catch(err => {
            console.warn('VAST regeneration warning:', err.message);
          });
        });
        console.log('🔄 VAST regeneration queued for element:', id);
      } catch (vastError) {
        console.warn('Could not regenerate VAST:', vastError.message);
        // Don't fail the update if VAST regeneration fails
      }
    }

    const message = element
      ? 'Overlay element updated successfully'
      : 'Overlay element created successfully';

    res.json({
      message,
      element: updatedElement,
      isNew: !element
    });
  } catch (error) {
    console.error('Update element error:', error);

    if (error.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid element ID format',
        details: error.message
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};

//// Delete an overlay element by ID
// const deleteElement = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user.id;

//     // Convert userId to ObjectId
//     const userObjectId = new mongoose.Types.ObjectId(userId);

//     // Find element and verify ownership directly through userId
//     const element = await OverlayElement.findOne({ _id: id, userId: userObjectId });

//     if (!element) {
//       return res.status(404).json({ error: 'Overlay element not found' });
//     }

//     await element.deleteOne();

//     res.json({
//       message: 'Overlay element deleted successfully',
//       element
//     });
//   } catch (error) {
//     console.error('Delete element error:', error);

//     if (error.kind === 'ObjectId') {
//       return res.status(400).json({ error: 'Invalid element ID' });
//     }

//     res.status(500).json({ error: 'Internal server error' });
//   }
// };

module.exports = {
  createElement,
  getAllElements,
  getElementById,
  updateElement,
  deleteElement
};
