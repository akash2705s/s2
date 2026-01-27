const xmlbuilder = require("xmlbuilder");

exports.generateLBannerXml = (element) => {
    const layout = element.configuration?.layout?.segments || [];
    // 🔧 FIX: Convert object to array
    const contentObj = element.configuration?.content?.elements || {};
    const content = Object.values(contentObj);


// Updated mapper
    const findSeg = (pos) => {
        // find layout position
        const index = layout.findIndex(s => s.position === pos);
        if (index === -1) return null;

        // find content at same index
        const segContent = content[index];
        if (!segContent) return null;

        // merge and return
        return { ...segContent, layout: layout[index] };
    };

    const horizontal = findSeg("bottom");
    const vertical = findSeg("left");

    const xml = xmlbuilder.create("Extensions");
    const ext = xml.ele("Extension", { type: "l-banner" });
    const lBanner = ext.ele("LBanner");

    // ==============================
    // HORIZONTAL BOTTOM SEGMENT
    // ==============================
    if (horizontal) {
        const seg = horizontal;
        const h = lBanner.ele("Horizontal");

        h.ele("ImageURL").cdata(seg.media.url);
        h.ele("Width").txt(seg.layout.width);
        h.ele("Height").txt(seg.layout.height);
        h.ele("X").txt(40);
        h.ele("Y").txt(760);

        const btnWrap = h.ele("Buttons");
        const btn = btnWrap.ele("Button", {
            id: `${seg.segmentId}-btn`,
            defaultFocus: "true",
            role: "primary"
        });

        btn.ele("Label").txt(seg.button?.label || "Learn More");

        const pos = btn.ele("Position");
        pos.ele("X").txt(420);
        pos.ele("Y").txt(780);
        pos.ele("Width").txt(180);
        pos.ele("Height").txt(60);

        const action = btn.ele("Action", { type: "clickthrough" });
        action.ele("ClickThrough").cdata(seg.button?.url || "");
        action.ele("DeepLink").cdata(seg.button?.deepLink || "");

        const track = btn.ele("TrackingEvents");
        track.ele("Tracking", { event: "click" })
            .cdata(`${process.env.DOMAIN_NAME}/api/track/creativeClick/${element.meta.id}/${seg.layout.id}`);
        track.ele("Tracking", { event: "viewable" })
            .cdata(`${process.env.DOMAIN_NAME}/api/track/creativeView/${element.meta.id}/${seg.layout.id}`);
    }

    // ==============================
    // VERTICAL LEFT SEGMENT
    // ==============================
    if (vertical) {
        const seg = vertical;
        const v = lBanner.ele("Vertical");

        v.ele("ImageURL").cdata(seg.media.url);
        v.ele("Width").txt(seg.layout.width);
        v.ele("Height").txt(seg.layout.height);
        v.ele("X").txt(40);
        v.ele("Y").txt(260);

        const btnWrap = v.ele("Buttons");
        const btn = btnWrap.ele("Button", {
            id: `${seg.segmentId}-btn`,
            role: "secondary"
        });

        btn.ele("Label").txt(seg.button?.label || "Get Offer");

        const posV = btn.ele("Position");
        posV.ele("X").txt(60);
        posV.ele("Y").txt(640);
        posV.ele("Width").txt(140);
        posV.ele("Height").txt(60);

        const action = btn.ele("Action", { type: "clickthrough" });
        action.ele("ClickThrough").cdata(seg.button?.url || "");
        action.ele("DeepLink").cdata(seg.button?.deepLink || "");

        const track = btn.ele("TrackingEvents");
        track.ele("Tracking", { event: "click" })
            .cdata(`${process.env.DOMAIN_NAME}/api/track/creativeClick/${element.meta.id}/${seg.layout.id}`);
        track.ele("Tracking", { event: "viewable" })
            .cdata(`${process.env.DOMAIN_NAME}/api/track/creativeView/${element.meta.id}/${seg.layout.id}`);
    }

    // GLOBAL DISPLAY TIMING
    const disp = lBanner.ele("Display");
    disp.ele("StartOffset").txt("00:00:03");
    disp.ele("EndOffset").txt("00:00:13");

    return xml.end({
        pretty: true,
        xmldec: { version: "1.0", encoding: "UTF-8" }
    });
};
