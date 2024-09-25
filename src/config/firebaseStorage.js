const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const path = require('path');
const Loan = require('../models/Customers/Loans/LoanModel');
const Document = require('../models/Customers/Loans/DocumentsModel');

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
async function getSignedUrl(url, expirationTime = 3600) {
  const filePath = extractFilePath(url);
  const file = bucket.file(filePath);

  try {
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expirationTime * 1000,
    });
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
}

function extractFilePath(input) {
  try {
    // Try to parse as a full URL
    const parsedUrl = new URL(input);
    const pathParts = parsedUrl.pathname.split('/');
    // Remove the first two segments (which are likely the repeated bucket name)
    return decodeURIComponent(pathParts.slice(2).join('/'));
  } catch (error) {
    // If parsing as URL fails, assume it's already a relative path
    return decodeURIComponent(input);
  }
}
// New function to delete documents
async function deleteDocuments(loanId) {
  try {
    const loan = await Loan.findById(loanId).populate('documents');
    if (!loan) {
      throw new Error('Loan not found');
    }

    for (const doc of loan.documents) {
      const filePath = extractFilePath(doc.documentUrl);
      try {
        await bucket.file(filePath).delete();
      } catch (error) {
        console.error(`Error deleting file from Firebase Storage: ${error.message}`);
        // Continue with the deletion process even if a file is not found in Firebase Storage
      }
      await Document.findByIdAndDelete(doc._id);
    }

    // Clear the documents array in the loan
    loan.documents = [];
    await loan.save();

    return { message: 'Documents deleted successfully' };
  } catch (error) {
    console.error('Error deleting documents:', error);
    throw error;
  }
}

module.exports = { uploadFile, getSignedUrl, extractFilePath, deleteDocuments };