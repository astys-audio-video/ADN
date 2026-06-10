const https = require('https');
const url = require('url');

const GOOGLE_SHEET_WEBAPP_URL = process.env.GOOGLE_SHEET_WEBAPP_URL;

/**
 * Dispatch registration data to the Google Apps Script Web App URL.
 * Automatically resolves HTTP 301/302 redirects.
 * @param {Object} record - Sanitized registration record
 * @returns {Promise<Object>} Status report
 */
function syncToGoogleSheets(record) {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_SHEET_WEBAPP_URL) {
      console.warn('[Sheets Warning] GOOGLE_SHEET_WEBAPP_URL is not defined. Sheet sync skipped.');
      return resolve({ skipped: true, reason: 'Missing GOOGLE_SHEET_WEBAPP_URL' });
    }

    const payload = JSON.stringify(record);
    sendPostRequest(GOOGLE_SHEET_WEBAPP_URL, payload, resolve, reject);
  });
}

function sendPostRequest(targetUrl, payload, resolve, reject) {
  try {
    const parsedUrl = url.parse(targetUrl);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      // Google redirects Apps Script web app requests (302 Found)
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          return sendPostRequest(redirectUrl, payload, resolve, reject);
        }
      }

      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[Sheets Success] Registration record synchronized to Google Sheets');
          resolve({ success: true, body: responseBody });
        } else {
          console.error('[Sheets Error] Google Web App returned status:', res.statusCode, responseBody);
          reject(new Error(`Google Web App returned HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Sheets Error] Sync request failed:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  } catch (err) {
    console.error('[Sheets Error] Execution failed:', err.message);
    reject(err);
  }
}

module.exports = {
  syncToGoogleSheets
};
