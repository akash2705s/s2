require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const apiRoutes = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

// Disable strict routing to handle trailing slashes
app.set('strict routing', false);

// Connect to MongoDB
connectDB();

// Middleware
// Configure CORS to allow credentials and common headers
// Support both localhost and Vercel deployments
const allowedOrigins = [
  'http://localhost:5173', // Vite default dev server
  'http://localhost:3000', // Alternative local port
  'http://localhost:5174', // Alternative Vite port
  'https://canvas-siau-app-dev.vercel.app', // Vercel client
  'https://canvas-siau-app-dev.vercel.app/', // Vercel client
  'https://free-player.vercel.app/',
  'https://cis.canvas.space/',
  'https://cis.canvas.space',
  process.env.CLIENT_URL, // Allow override via environment variable
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      // In production, be more strict
      if (process.env.NODE_ENV === 'production' && !allowedOrigins.includes(origin)) {
        console.warn(`CORS blocked origin: ${origin}`);
      }
      callback(null, true); // Still allow for flexibility, but log it
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposedHeaders: ['Content-Length', 'X-Request-Id']
}));

// IMPORTANT:
// Don't run JSON / URL-encoded body parsers on multipart/form-data requests,
// otherwise busboy (used by multer) can see a partially-consumed stream and throw
// "Malformed part header" when parsing file uploads.
//
// We only apply express.json / express.urlencoded when the content-type is NOT multipart.
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.startsWith('multipart/form-data')) {
    // Let upload middleware (multer) handle this request body
    return next();
  }

  // Chain json and urlencoded parsers manually so they don't touch multipart
  express.json()(req, res, (err) => {
    if (err) return next(err);
    express.urlencoded({ extended: true })(req, res, next);
  });
});

// Request logging middleware - logs all incoming requests
// IMPORTANT: For multipart requests, don't try to read req.body (it hasn't been parsed yet)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const startTime = Date.now();
  const contentType = req.headers['content-type'] || '';
  const isMultipart = contentType.startsWith('multipart/form-data');

  console.log('\n=== INCOMING REQUEST ===');
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  // Extract IP for logging
  const forwardedFor = req.headers['x-forwarded-for'];
  const realIP = req.headers['x-real-ip'];
  const extractedIP = forwardedFor?.split(',')[0]?.trim() || realIP || req.ip || 'unknown';

  console.log('Headers:', {
    'content-type': req.headers['content-type'],
    'authorization': req.headers.authorization ? `${req.headers.authorization.substring(0, 20)}...` : 'none',
    'user-agent': req.headers['user-agent'],
    'x-forwarded-for': forwardedFor || 'none',
    'x-real-ip': realIP || 'none',
    'extracted-ip': extractedIP
  });
  console.log('Query Params:', req.query);

  // Only log body for non-multipart requests (multipart body will be parsed by multer)
  if (!isMultipart) {
    console.log('Body:', req.body);
  } else {
    console.log('Body: [multipart/form-data - will be parsed by multer]');
  }

  // Files will be populated by multer after uploadMiddleware runs
  console.log('Files:', req.files ? `${req.files.length} file(s)` : 'none');

  // Log response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`\n=== RESPONSE ===`);
    console.log(`[${timestamp}] ${req.method} ${req.url} - Status: ${res.statusCode} - ${duration}ms`);
    if (req.files && req.files.length > 0) {
      console.log(`Files processed: ${req.files.length}`);
    }
    console.log('================\n');
  });

  console.log('========================\n');
  next();
});

// Note: Files are now stored on AWS S3, not served locally

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the server!' });
});

// Mount API routes
app.use('/api', apiRoutes);

// 404 handler - must be after all routes
app.use((req, res, next) => {
  console.log('\n=== 404 NOT FOUND ===');
  console.log('Path:', req.path);
  console.log('Method:', req.method);
  console.log('Original URL:', req.originalUrl);
  console.log('====================\n');
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
