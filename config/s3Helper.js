const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../config/aws");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ⬅️ Upload XML to S3
exports.uploadToS3 = async (key, body) => {
    const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: "application/xml"
    });

    return s3Client.send(command);
};

// ⬅️ Get XML from S3
exports.getFromS3 = async (key) => {
    try {
        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key
        });

        const data = await s3Client.send(command);
        return await streamToString(data.Body);
    } catch (err) {
        return null;
    }
};

// Helper: convert stream to string
const streamToString = (stream) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
