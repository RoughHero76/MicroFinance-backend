const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const path = require('path');

if (!admin.apps.length) {
  const serviceAccount = require("../../secrets/evonline-cd277-firebase-adminsdk-ranbm-a3ecc5fb9c.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "evonline-cd277.appspot.com"
  });
}

const bucket = getStorage().bucket();

// Function to upload a file to Firebase Storage
async function uploadFile(file, destination) {
  const fileName = `${Date.now()}_${path.basename(file.originalname)}`;
  const fileUpload = bucket.file(`${destination}/${fileName}`);

  const blobStream = fileUpload.createWriteStream({
    metadata: {
      contentType: file.mimetype
    }
  });

  return new Promise((resolve, reject) => {
    blobStream.on('error', (error) => reject(error));
    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileUpload.name}`;
      resolve(publicUrl);
    });
    blobStream.end(file.buffer);
  });
}

// Function to get a signed URL for temporary access
async function getSignedUrl(filePath, expirationTime = 3600) {
  const file = bucket.file(filePath);

  try {
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expirationTime * 1000, // Convert seconds to milliseconds
    });
    return url;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
}

module.exports = { uploadFile, getSignedUrl };