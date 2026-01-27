const OverlayElement = require('../models/OverlayElement');

/**
 * Generate embed script for an element
 */
exports.generateEmbedScript = async (req, res) => {
  try {
    const { elementId } = req.params;
    const userId = req.user.id;

    // Find element and verify ownership
    const element = await OverlayElement.findOne({ _id: elementId, userId });
    if (!element) {
      return res.status(404).json({ error: 'Element not found' });
    }

    // Get API base URL from environment
    const apiBaseUrl = process.env.DOMAIN_NAME || 'https://canvas-siau-server-dev.vercel.app';
    const vastUrl = `${apiBaseUrl}/api/vasts/vast/${elementId}`;

    // Get main video URL from element configuration
    const mainVideoUrl = element.configuration?.mainVideoUrl || 'YOUR_VIDEO_URL_HERE';

    // Generate the embed script
    const script = `<script src="https://cdn.jsdelivr.net/gh/akash768145s/Canvas@1.0/dist/canvas-player.min.js"></script>
<script>
  document.addEventListener("DOMContentLoaded", async () => {
      await canvasplayer.init({
        vastUrl: "${vastUrl}",
      });
  });
</script>`;

    res.json({
      elementId,
      elementName: element.meta?.title || 'Untitled Element',
      vastUrl,
      mainVideoUrl: mainVideoUrl || null,
      script,
      instructions: mainVideoUrl ? [
        '1. Copy the script above.',
        '2. The video URL is already set from your element configuration.',
        '3. Paste the script after your player markup; include the CSS bundle once per page.',
        '4. The ad will automatically load and display based on your element configuration.'
      ] : [
        '1. Copy the script above.',
        '2. Replace YOUR_VIDEO_URL_HERE with your actual video URL (or set it in the editor).',
        '3. Paste the script after your player markup; include the CSS bundle once per page.',
        '4. The ad will automatically load and display based on your element configuration.'
      ]
    });
  } catch (error) {
    console.error('Script generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

