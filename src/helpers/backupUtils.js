const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs'); // Regular fs for createWriteStream
const fsp = require('fs').promises; // fs.promises for async operations
require('dotenv').config(); // Load environment variables from .env
const archiver = require('archiver'); // For zipping backup

const dumpCollection = async (collection, dumpPath) => {
    const collectionPath = path.join(dumpPath, `${collection.collectionName}.json`);
    const writeStream = await fsp.open(collectionPath, 'w');

    // Write the opening array bracket for JSON
    await writeStream.write('[');

    let first = true; // Track if this is the first document to handle commas

    // Use a cursor to fetch documents in batches
    const cursor = collection.find({}).batchSize(100); // Adjust batchSize as needed

    await cursor.forEach(async (doc) => {
        if (!first) {
            await writeStream.write(',\n'); // Add a comma before each document except the first
        }
        await writeStream.write(JSON.stringify(doc, null, 2));
        first = false; // Now subsequent documents should add a comma
    });

    // Write the closing array bracket for JSON
    await writeStream.write(']');

    // Close the write stream
    await writeStream.close();
};

const dumpDatabase = async (client, targetDatabaseName, dumpPath) => {
    try {
        const targetDb = client.db(targetDatabaseName);
        const collections = await targetDb.collections(); // Use .collections() for an array of collection objects

        for (const collection of collections) {
            await dumpCollection(collection, dumpPath);
        }
    } catch (error) {
        console.error(`Error dumping database: ${error.message}`);
        throw error;
    }
};

const backupDB = () => {
    return new Promise(async (resolve, reject) => {
        const backupDir = path.join(__dirname, 'backup');
        const dumpPath = path.join(backupDir, 'mongodb_backup');
        const mongoUri = process.env.MONGODB_DUMP_URI; // MongoDB URI from environment variable
        const targetDatabaseName = 'microfinance'; // Database name

        // Ensure the URI is defined
        if (!mongoUri) {
            return reject(new Error('MONGODB_DUMP_URI is not defined in the environment'));
        }

        try {
            // Create backup directories
            await fsp.mkdir(backupDir, { recursive: true });
            await fsp.mkdir(dumpPath, { recursive: true });

            // Connect to MongoDB
            const client = new MongoClient(mongoUri, {
                maxPoolSize: 10, // Adjust pool size based on expected load
                socketTimeoutMS: 3600000, // Set a long socket timeout (1 hour)
                connectTimeoutMS: 30000, // Connection timeout
            });

            await client.connect();

            // Dump the database collections
            await dumpDatabase(client, targetDatabaseName, dumpPath);

            await client.close();
            resolve(dumpPath);
        } catch (error) {
            console.error('backupDB: Error during backup:', error.message);
            reject(error);
        }
    });
};

const zipBackup = (backupDir) => {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(path.join(__dirname, 'backup.zip')); // Using fs.createWriteStream
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            resolve(path.join(__dirname, 'backup.zip'));
        });

        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(backupDir, false);
        archive.finalize();
    });
};

const backupAndSendResponse = async (req, res) => {
    try {
        const backupDir = await backupDB();
        const zipFile = await zipBackup(backupDir);

        res.download(zipFile, 'database_backup.zip', async (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).send('Error sending backup file');
            }
            // Clean up the zip file and backup directory after sending
            await fsp.unlink(zipFile); // Using fs.promises.unlink
            await fsp.rm(backupDir, { recursive: true, force: true }); // Using fs.promises.rm
        });
    } catch (error) {
        console.error('Backup process failed:', error);
        res.status(500).send('Backup process failed');
    }
};

module.exports = { backupAndSendResponse };
