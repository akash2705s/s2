require('dotenv').config();
const mongoose = require('mongoose');
const OverlayElement = require('../models/OverlayElement');
const connectDB = require('../config/database');

// Banner ID and user email to share with
const BANNER_ID = 'elem_corner_banner_1764413032946';
const SHARE_WITH_EMAIL = 'ourcal@canvas.space';

async function shareBanner() {
  try {
    // Connect to database
    console.log('Connecting to MongoDB...');
    await connectDB();
    
    // Find the banner
    console.log(`Looking for banner: ${BANNER_ID}`);
    const banner = await OverlayElement.findById(BANNER_ID);
    
    if (!banner) {
      console.error(`❌ Banner not found: ${BANNER_ID}`);
      process.exit(1);
    }
    
    console.log(`✅ Found banner owned by: ${banner.userId}`);
    console.log(`Current sharedWith:`, banner.sharedWith || []);
    
    // Add user to sharedWith array
    const result = await OverlayElement.findByIdAndUpdate(
      BANNER_ID,
      { $addToSet: { sharedWith: SHARE_WITH_EMAIL } },
      { new: true }
    );
    
    console.log(`\n✅ Successfully shared banner with: ${SHARE_WITH_EMAIL}`);
    console.log(`Updated sharedWith:`, result.sharedWith);
    console.log(`\nBanner details:`);
    console.log(`  - Banner ID: ${result._id}`);
    console.log(`  - Owner: ${result.userId}`);
    console.log(`  - Shared with: ${result.sharedWith.join(', ')}`);
    console.log(`  - Copy Type: SHALLOW_REFERENCE`);
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✅ Done!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error sharing banner:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
shareBanner();

