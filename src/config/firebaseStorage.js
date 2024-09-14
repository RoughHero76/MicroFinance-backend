const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const path = require('path');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
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