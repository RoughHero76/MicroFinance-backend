const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const stream = require('stream');
const { promisify } = require('util');

const pipeline = promisify(stream.pipeline);
require('dotenv').config();

/**
 * Validate version string format
 * @param {string} version Version string to validate
 * @returns {boolean} True if valid, false otherwise
 */
const isValidVersion = (version) => {
    const versionRegex = /^\d+(\.\d+)*$/;
    return versionRegex.test(version);
};

/**
 * Compare version strings
 * @param {string} v1 First version string
 * @param {string} v2 Second version string
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
const compareVersions = (v1, v2) => {
    if (!isValidVersion(v1) || !isValidVersion(v2)) {
        throw new Error('Invalid version format');
    }

    const v1parts = v1.split('.').map(Number);
    const v2parts = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
        const v1part = v1parts[i] || 0;
        const v2part = v2parts[i] || 0;

        if (v1part > v2part) return 1;
        if (v1part < v2part) return -1;
    }

    return 0;
};

exports.appUpdateCheck = async (req, res) => {
    try {
        // Extract currentVersion from query and clean it
        let { currentVersion } = req.query;

        // Input validation
        if (!currentVersion) {
            return res.status(400).json({
                status: 'error',
                message: 'Current app version is required'
            });
        }

        // Clean the version string
        currentVersion = currentVersion.trim().toLowerCase().replace(/^v/, '');

        // Validate version format
        if (!isValidVersion(currentVersion)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid version format. Expected format: x.x.x (e.g., 1.0.0)'
            });
        }

        console.log(`Checking for updates. Current version: ${currentVersion}`);

        const owner = 'RoughHero76';
        const repo = 'MicroFinance';
        const githubToken = process.env.GITHUB_ACCESS_TOKEN;

        if (!githubToken) {
            console.error('GitHub token missing in server configuration');
            return res.status(500).json({
                status: 'error',
                message: 'Server configuration error'
            });
        }

        // Get releases
        const releasesApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
        const releasesResponse = await axios.get(releasesApiUrl, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        const releases = releasesResponse.data;

        if (!Array.isArray(releases) || releases.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No releases found'
            });
        }

        const latestRelease = releases[0];
        const assets = latestRelease.assets;

        if (!Array.isArray(assets) || assets.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No assets found in the latest release'
            });
        }

        const apkAsset = assets.find(asset => asset.name.endsWith('.apk'));
        if (!apkAsset) {
            return res.status(404).json({
                status: 'error',
                message: 'No APK found in the latest release'
            });
        }

        // Extract and validate latest version
        const latestVersionMatch = apkAsset.name.match(/v?(\d+(\.\d+)*)/);
        if (!latestVersionMatch) {
            console.error(`Invalid version format in APK filename: ${apkAsset.name}`);
            return res.status(500).json({
                status: 'error',
                message: 'Server error: Invalid release version format'
            });
        }

        const latestVersion = latestVersionMatch[1];

        try {
            const versionComparison = compareVersions(latestVersion, currentVersion);

            const response = {
                status: 'success',
                currentVersion,
                latestVersion,
                updateAvailable: versionComparison > 0
            };

            if (versionComparison > 0) {
                // Update available
                response.downloadUrl = apkAsset.browser_download_url;
                response.releaseNotes = latestRelease.body || 'No release notes available';
                response.publishedAt = latestRelease.published_at;
            } else if (versionComparison < 0) {
                // Current version is newer than latest release
                response.message = 'Your version is newer than the latest release';
            } else {
                // Versions are equal
                response.message = 'You have the latest version';
            }

            res.json(response);

        } catch (versionError) {
            console.error('Version comparison error:', versionError);
            return res.status(400).json({
                status: 'error',
                message: 'Invalid version format'
            });
        }

    } catch (error) {
        console.error('Error during app update check:', error);

        // Handle specific axios errors
        if (error.response) {
            // The request was made and the server responded with a non-2xx status
            const statusCode = error.response.status;
            let errorMessage = 'Failed to check for updates';

            switch (statusCode) {
                case 401:
                    errorMessage = 'Unauthorized: Invalid GitHub token';
                    break;
                case 403:
                    errorMessage = 'Forbidden: Rate limit exceeded or lack of permissions';
                    break;
                case 404:
                    errorMessage = 'Repository not found';
                    break;
            }

            return res.status(statusCode).json({
                status: 'error',
                message: errorMessage
            });
        } else if (error.request) {
            // The request was made but no response was received
            return res.status(503).json({
                status: 'error',
                message: 'Unable to reach update server'
            });
        }

        // Generic error response
        res.status(500).json({
            status: 'error',
            message: 'Internal server error while checking for updates'
        });
    }
};

const GITHUB_API_TIMEOUT = 10000; // 10 seconds for API requests
const DOWNLOAD_TIMEOUT = 30000;   // 30 seconds for file downloads

const apiClient = axios.create({
    timeout: GITHUB_API_TIMEOUT,
    headers: {
        'Accept': 'application/vnd.github.v3+json'
    }
});

const downloadClient = axios.create({
    timeout: DOWNLOAD_TIMEOUT,
    responseType: 'arraybuffer' // Changed from 'stream' to 'arraybuffer'
});

exports.downloadApk = async (req, res) => {
    const owner = 'RoughHero76';
    const repo = 'MicroFinance';
    const githubToken = process.env.GITHUB_ACCESS_TOKEN;
    const cacheDir = path.join(__dirname, 'apk_cache');

    console.log('Processing APK download request...');

    if (!githubToken) {
        console.error('GitHub token missing');
        return res.status(500).json({
            status: 'error',
            message: 'Server configuration error: GitHub token missing'
        });
    }

    try {
        // Ensure cache directory exists
        await fs.mkdir(cacheDir, { recursive: true });

        // Set auth headers for both clients
        apiClient.defaults.headers.common['Authorization'] = `token ${githubToken}`;
        downloadClient.defaults.headers.common['Authorization'] = `token ${githubToken}`;

        // Fetch the latest release
        const releasesApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
        console.log(`Fetching releases from ${releasesApiUrl}`);
        const releasesResponse = await apiClient.get(releasesApiUrl);

        const releases = releasesResponse.data;
        if (!releases || releases.length === 0) {
            console.log('No releases found');
            return res.status(404).json({
                status: 'error',
                message: 'No releases found'
            });
        }

        const latestRelease = releases[0];
        const apkAsset = latestRelease.assets.find(asset => asset.name.endsWith('.apk'));

        if (!apkAsset) {
            console.log('No APK found in the latest release');
            return res.status(404).json({
                status: 'error',
                message: 'No APK found in the latest release'
            });
        }

        const apkPath = path.join(cacheDir, apkAsset.name);
        let apkExists = false;

        try {
            await fs.access(apkPath);
            apkExists = true;
        } catch (error) {
            // File doesn't exist, we'll download it
        }

        if (!apkExists) {
            console.log(`Downloading APK from ${apkAsset.url}`);
            const apkResponse = await downloadClient.get(apkAsset.url, {
                headers: {
                    'Accept': 'application/octet-stream'
                },
                responseType: 'arraybuffer'
            });

            await fs.writeFile(apkPath, apkResponse.data);
            console.log('APK downloaded and saved');
        } else {
            console.log('Using cached APK');
        }

        // Stream the APK file to the client
        const fileStream = fsSync.createReadStream(apkPath);
        const stat = await fs.stat(apkPath);

        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', `attachment; filename=${apkAsset.name}`);
        res.setHeader('Content-Length', stat.size);

        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error streaming APK file'
                });
            }
        });

        fileStream.on('end', () => {
            console.log('APK streaming completed');
            res.end(); // Ensure the response is properly ended
        });

    } catch (error) {
        console.error('Error in downloadApk:', error);

        let statusCode = 500;
        let errorMessage = 'Failed to download APK';

        if (error.message === 'GitHub API request timed out' || error.message === 'APK download timed out') {
            statusCode = 504;
            errorMessage = error.message;
        } else if (error.response) {
            statusCode = error.response.status;
            switch (statusCode) {
                case 401:
                    errorMessage = 'Unauthorized: Invalid GitHub token';
                    break;
                case 403:
                    errorMessage = 'Forbidden: Rate limit exceeded or lack of permissions';
                    break;
                case 404:
                    errorMessage = 'Repository or release not found';
                    break;
            }
        }

        if (!res.headersSent) {
            res.status(statusCode).json({
                status: 'error',
                message: errorMessage
            });
        }
    }
};