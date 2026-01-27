const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const sharp = require('sharp');
const { s3Client } = require('../config/aws');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Memory storage for processing files before S3 upload
const memoryStorage = multer.memoryStorage();

// Configure S3 storage for non-image files (videos, etc.)
// Note: ACL removed - bucket uses bucket policies for access control
const s3Storage = multerS3({
  s3: s3Client,
  bucket: process.env.S3_BUCKET_NAME,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  metadata: function (req, file, cb) {
    cb(null, {
      fieldName: file.fieldname,
      originalName: file.originalname
    });
  },
  key: function (req, file, cb) {
    // Generate unique filename: uploads/timestamp-randomstring-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const filename = `uploads/${nameWithoutExt}-${uniqueSuffix}${ext}`;
    cb(null, filename);
  }
});

// File filter for allowed file types
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
    'video/ogg',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/ogg',
    'application/pdf',
    'application/json'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`), false);
  }
};

// Configure multer with memory storage for image compression
const upload = multer({
  storage: memoryStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Middleware to handle multiple files (max 5) - using .any() to accept any field name
const uploadFiles = upload.any();

// Helper function to compress image with Sharp - more aggressive lossless compression
async function compressImage(buffer, mimetype) {
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
}

// Helper function to upload to S3 and generate presigned URL
async function uploadToS3(buffer, key, contentType, originalName) {
  try {
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Note: ACL removed - bucket uses bucket policies for access control
      Metadata: {
        originalName: originalName
      }
    });

    await s3Client.send(command);

    // Generate presigned URL that's valid for 10 years (effectively permanent for public access)
    // NOTE: For true public access, configure S3 bucket policy to allow public read:
    // {
    //   "Version": "2012-10-17",
    //   "Statement": [{
    //     "Effect": "Allow",
    //     "Principal": "*",
    //     "Action": "s3:GetObject",
    //     "Resource": "arn:aws:s3:::BUCKET_NAME/uploads/*"
    //   }]
    // }
    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key
    });

    // AWS S3 presigned URLs have a maximum expiration of 7 days (604800 seconds)
    // For permanent public access, configure S3 bucket policy instead
    const presignedUrl = await getSignedUrl(s3Client, getObjectCommand, {
      expiresIn: 604800 // 7 days (maximum allowed by AWS)
    });

    // Also provide the direct URL in case bucket policy allows public access
    const region = process.env.AWS_REGION || 'us-east-2';
    const directUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;

    return {
      location: presignedUrl, // Use presigned URL for guaranteed access
      directUrl: directUrl, // Direct URL for reference
      key: key,
      bucket: process.env.S3_BUCKET_NAME,
      size: buffer.length,
      mimetype: contentType
    };
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw error;
  }
}

// Middleware wrapper with error handling and image compression
const uploadMiddleware = async (req, res, next) => {
  uploadFiles(req, res, async function (err) {
    try {
      if (err instanceof multer.MulterError) {
        // Multer error occurred
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size too large. Maximum size is 10MB.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: 'Too many files. Maximum is 5 files.' });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: 'Unexpected field in upload' });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        // Unknown error occurred
        console.error('Multer error:', err);
        return res.status(400).json({ error: err.message });
      }

      // Limit total number of files to 5
      if (req.files && req.files.length > 5) {
        return res.status(400).json({ error: 'Too many files. Maximum is 5 files.' });
      }

      // Process files: compress images and upload to S3
      if (req.files && req.files.length > 0) {
        try {
          const processedFiles = await Promise.all(
            req.files.map(async (file) => {
              const isImage = file.mimetype.startsWith('image/') &&
                !file.mimetype.includes('svg'); // Skip SVG

              if (isImage && file.buffer) {
                // Compress image
                const compressedBuffer = await compressImage(file.buffer, file.mimetype);

                // Generate unique filename
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                const nameWithoutExt = path.basename(file.originalname, ext);
                const key = `uploads/${nameWithoutExt}-${uniqueSuffix}${ext}`;

                // Upload compressed image to S3
                const s3Result = await uploadToS3(
                  compressedBuffer,
                  key,
                  file.mimetype,
                  file.originalname
                );

                return {
                  fieldname: file.fieldname,
                  originalname: file.originalname,
                  encoding: file.encoding,
                  mimetype: file.mimetype,
                  size: s3Result.size,
                  bucket: s3Result.bucket,
                  key: s3Result.key,
                  location: s3Result.location,
                };
              } else {
                // For non-image files, upload directly to S3
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                const nameWithoutExt = path.basename(file.originalname, ext);
                const key = `uploads/${nameWithoutExt}-${uniqueSuffix}${ext}`;

                const s3Result = await uploadToS3(
                  file.buffer,
                  key,
                  file.mimetype,
                  file.originalname
                );

                return {
                  fieldname: file.fieldname,
                  originalname: file.originalname,
                  encoding: file.encoding,
                  mimetype: file.mimetype,
                  size: s3Result.size,
                  bucket: s3Result.bucket,
                  key: s3Result.key,
                  location: s3Result.location,
                };
              }
            })
          );

          req.files = processedFiles;
        } catch (error) {
          console.error('Error processing files:', error);
          console.error('Error stack:', error.stack);
          return res.status(500).json({ error: 'Failed to process files: ' + error.message });
        }
      }

      // Everything went fine
      next();
    } catch (error) {
      console.error('Unexpected error in upload middleware:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({ error: 'Upload middleware error: ' + error.message });
    }
  });
};

module.exports = { uploadMiddleware };
