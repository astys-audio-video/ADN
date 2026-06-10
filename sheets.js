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
          // Follow redirect using GET (Google User Content CDN only allows GET for the text output)
          return sendGetRequest(redirectUrl, resolve, reject);
        }
      }

      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        handleResponse(res.statusCode, responseBody, resolve, reject);
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

function sendGetRequest(targetUrl, resolve, reject) {
  try {
    const parsedUrl = url.parse(targetUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.path,
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          return sendGetRequest(redirectUrl, resolve, reject);
        }
      }

      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        handleResponse(res.statusCode, responseBody, resolve, reject);
      });
    });

    req.on('error', (err) => {
      console.error('[Sheets Error] Redirect GET request failed:', err.message);
      reject(err);
    });

    req.end();
  } catch (err) {
    console.error('[Sheets Error] Redirect execution failed:', err.message);
    reject(err);
  }
}

function handleResponse(statusCode, responseBody, resolve, reject) {
  if (statusCode >= 200 && statusCode < 300) {
    try {
      const parsedRes = JSON.parse(responseBody);
      if (parsedRes.status === 'error') {
        console.error('[Sheets Error] Google Apps Script execution failed:', parsedRes.message);
        return reject(new Error(parsedRes.message));
      }
      console.log('[Sheets Success] Registration record synchronized to Google Sheets');
      resolve({ success: true, body: responseBody });
    } catch (e) {
      // In case Google returns a generic HTML/text response
      console.log('[Sheets Success] Synchronized to Google Sheets (Non-JSON response)');
      resolve({ success: true, body: responseBody });
    }
  } else {
    console.error('[Sheets Error] Google Web App returned status:', statusCode, responseBody);
    reject(new Error(`Google Web App returned HTTP ${statusCode}`));
  }
}

module.exports = {
  syncToGoogleSheets
};
