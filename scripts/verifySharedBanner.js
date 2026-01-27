require('dotenv').config();
const mongoose = require('mongoose');
const OverlayElement = require('../models/OverlayElement');
const User = require('../models/User'); // Import User model for populate
const connectDB = require('../config/database');

const BANNER_ID = 'elem_corner_banner_1764413032946';
const USER_EMAIL = 'ourcal@canvas.space';

async function verifySharedBanner() {
    try {
        console.log('Connecting to MongoDB...');
        await connectDB();

        console.log(`\nChecking banner: ${BANNER_ID}`);
        const banner = await OverlayElement.findById(BANNER_ID)
            .populate('userId', 'email');

        if (!banner) {
            console.error(`❌ Banner not found: ${BANNER_ID}`);
            process.exit(1);
        }

        console.log(`✅ Banner found`);
        console.log(`  - Owner ID: ${banner.userId?._id || banner.userId}`);
        console.log(`  - Owner Email: ${banner.userId?.email || 'N/A'}`);
        console.log(`  - Shared With: ${JSON.stringify(banner.sharedWith || [])}`);
        console.log(`  - Is ${USER_EMAIL} in sharedWith? ${(banner.sharedWith || []).includes(USER_EMAIL) ? '✅ YES' : '❌ NO'}`);

        if ((banner.sharedWith || []).includes(USER_EMAIL)) {
            console.log(`\n✅ Banner is correctly shared with ${USER_EMAIL}`);
            console.log(`\nWhen ${USER_EMAIL} logs in and calls getAllElements, they should see this banner.`);
        } else {
            console.log(`\n❌ Banner is NOT shared with ${USER_EMAIL}`);
            console.log(`Run shareBanner.js to share it.`);
        }

        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

verifySharedBanner();

