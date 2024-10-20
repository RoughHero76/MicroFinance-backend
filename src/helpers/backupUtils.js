const { exec } = require('child_process');
const path = require('path');
const fs = require('fs'); // Regular fs for createWriteStream
const fsp = require('fs').promises; // fs.promises for async operations
require('dotenv').config(); // Load environment variables from .env
const archiver = require('archiver'); // For zipping backup

const backupDB = () => {
    return new Promise((resolve, reject) => {
        const backupDir = path.join(__dirname, 'backup');
        const dumpPath = path.join(backupDir, 'mongodb_backup');
        const mongoUri = process.env.MONGODB_DUMP_URI; // MongoDB URI from environment variable
        const targetDatabaseName = 'microfinance'; // Database name

        // Ensure the URI is defined
        if (!mongoUri) {
            return reject(new Error('MONGODB_DUMP_URI is not defined in the environment'));
        }

        try {
            // Create backup directory if it doesn't exist
            fsp.mkdir(backupDir, { recursive: true });

            // Use mongodump command to back up the specified database
            const command = `mongodump --uri="${mongoUri}" --db=${targetDatabaseName} --out=${dumpPath}`;

            // Execute the mongodump command
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error running mongodump:', error.message);
                    return reject(error);
                }

                if (stderr) {
                    console.error('mongodump stderr:', stderr);
                }

                console.log('mongodump stdout:', stdout);
                resolve(dumpPath);
            });
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
