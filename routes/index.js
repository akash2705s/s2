const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const brandRoutes = require('./brandRoutes');
const overlayRoutes = require('./overlayRoutes');
const adConfigRoutes = require('./adConfigRoutes');
const apiKeyRoutes = require('./apiKeyRoutes');
const vastRoutes = require('./vastRoutes');
const trackingRoutes = require("./trackingRoutes");
const analyticsRoutes = require("./analyticsRoutes");
const vastBrandRoutes = require("./vastBrandRoutes");
const scriptRoutes = require('./scriptRoutes');
const campaignRoutes = require('./campaignRoutes');
// Health check route
router.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});


// Video streaming route (similar style to your /health)
router.get('/video', (req, res) => {
  const videoPath = path.join(__dirname, '..', 'videos', 'your-20min-video.mp4'); // adjust path/filename
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (!range) {
    // Fallback: send full file (rare, most browsers send range)
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(videoPath).pipe(res);
    return;
  }

  // Parse the Range header (e.g. bytes=0- or bytes=500000-)
  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  // Validate
  if (start >= fileSize) {
    res.status(416).send('Requested range not satisfiable');
    return;
  }

  const chunkSize = (end - start) + 1;

  // Send 206 Partial Content
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': 'video/mp4',
  });

  // Stream only the requested chunk
  const stream = fs.createReadStream(videoPath, { start, end });
  stream.pipe(res);
});


// Mount auth routes
router.use('/auth', authRoutes);

// Mount user management routes (SuperAdmin only)
router.use('/users', userRoutes);

// Mount brand routes
router.use('/brands', brandRoutes);

// Mount overlay element routes
router.use('/elements', overlayRoutes);

// Mount ad configuration routes
router.use('/adconfig', adConfigRoutes);

// Mount API key routes
router.use('/key', apiKeyRoutes);
router.use('/vasts', vastRoutes);
router.use("/track", trackingRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/vastBrand", vastBrandRoutes);
router.use("/scripts", scriptRoutes);
router.use("/campaigns", campaignRoutes);



module.exports = router;
