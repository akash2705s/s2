// routes/vast.routes.js
const express = require("express");
const router = express.Router();
const {
    generateVastXml,
    handleInteractiveHorizontalNav,
} = require("../actions/vastActions");

// GET VAST XML by elementId
router.get("/vast/:elementId", generateVastXml);
router.post(
    "/vast/:elementId/horizontal/nav",
    handleInteractiveHorizontalNav
);

module.exports = router;
