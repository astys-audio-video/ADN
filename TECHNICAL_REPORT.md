# ADN Pune Chapter | Comprehensive Technical Architecture & Systems Engineering Report

**Author:** Lead Systems Architect / Senior Software Engineer  
**Date:** June 10, 2026  
**Status:** Release Version 1.1.0-PROD-SECURE  
**Environment:** Node.js (Vanilla, Zero External Dependencies)

---

## 1. Executive Summary

This document serves as the master engineering report for the new registration backend built for the **ADN Pune (Architects & Designers Network)** community platform. 

The backend is engineered for high-throughput, horizontal scalability, and strict security using **vanilla, zero-dependency Node.js core libraries** (no third-party frameworks like Express, and zero NPM installations required).

In this latest update, we integrated two critical cloud handlers:
1. **Gmail Alert Notifications**: Automatically emails form details to `adn.pune@gmail.com` on submission.
2. **Real-time Google Sheets Sync**: Connects the server to a Google Spreadsheet, appending rows automatically in the background using a lightweight Google Apps Script webhook.

---

## 2. Project Context & File Layout

The active server contains the following files:
* **[server.js](file:///c:/Users/ayush/Downloads/flow/server.js)**: Multi-process web server handling static assets, security routing, and dynamic CSRF token/Honeypot injection.
* **[storage.js](file:///c:/Users/ayush/Downloads/flow/storage.js)**: Handles data parsing, sanitization, local JSONL write, and initiates async email/Sheets triggers.
* **[rateLimiter.js](file:///c:/Users/ayush/Downloads/flow/rateLimiter.js)**: Security layer tracking IP request histories to stop brute force spammers.
* **[email.js](file:///c:/Users/ayush/Downloads/flow/email.js)**: Email utility utilizing the Resend REST API (zero dependencies) or an optional SMTP fallback.
* **[sheets.js](file:///c:/Users/ayush/Downloads/flow/sheets.js)**: Direct sync utility connecting the backend to a Google Spreadsheet.
* **[index.html](file:///c:/Users/ayush/Downloads/flow/index.html)**: Untouched frontend landing page layout served dynamically.
* **[registrations.jsonl](file:///c:/Users/ayush/Downloads/flow/registrations.jsonl)**: Append-only JSON Lines local database file.

---

## 3. High-Level System Design & Scaling Architecture

```mermaid
graph TD
    User[Form Submission] -->|POST /api/register| Server[Worker Process]
    Server -->|1. Local Backup Write| DB[(registrations.jsonl)]
    
    subgraph Core Dispatches
        Server -->|2. Asynchronous POST| GoogleScript[Google Apps Script Web App]
        Server -->|3. Asynchronous HTTPS| Resend[Resend Email API]
    end

    GoogleScript -->|Appends Row| GoogleSheet((Google Sheet / Spreadsheet))
    Resend -->|Delivers Email Alert| Inbox((adn.pune@gmail.com))
```

1. **Local Data Backup**: Submissions are written first to the local `.jsonl` database using atomic OS appends. This guarantees the registration is safe even if external networks (Gmail or Google Sheets) are temporarily down.
2. **Asynchronous Non-blocking Dispatches**: Email sending and Google Sheets writes are triggered asynchronously in the background. The server responds to the user's browser immediately so that the user sees the success screen in milliseconds without waiting for Google API turnarounds.
3. **Cluster Scalability**: The server splits requests round-robin across multiple CPU core worker processes, ensuring horizontal scalability.

---

## 4. Google Sheets Synchronization Setup

To link registrations to a Google Sheet:
1. Open your Google Sheet.
2. Navigate to **Extensions** > **Apps Script**.
3. Paste the following Apps Script code:
   ```javascript
   function doPost(e) {
     try {
       var data = JSON.parse(e.postData.contents);
       var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
       
       // Append headers if sheet is empty
       if (sheet.getLastRow() === 0) {
         sheet.appendRow(["ID", "Date & Time", "Full Name", "Firm Name", "Profession", "Mobile / WhatsApp", "City", "Instagram / Website", "Meetup Interest"]);
       }
       
       sheet.appendRow([
         data.id,
         data.created_at,
         data.full_name,
         data.firm_name,
         data.profession,
         data.mobile,
         data.city,
         data.website,
         data.meetup_interest
       ]);
       
       return ContentService.createTextOutput(JSON.stringify({ "status": "success" }))
         .setMimeType(ContentService.MimeType.JSON);
     } catch (error) {
       return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() }))
         .setMimeType(ContentService.MimeType.JSON);
     }
   }
   ```
4. Click **Deploy** > **New deployment**.
5. Set *Execute as* to `Me` and *Who has access* to `Anyone`.
6. Click **Deploy**, authorize Sheets permissions, and copy the **Web app URL**.
7. Set the environment variable `GOOGLE_SHEET_WEBAPP_URL` to this web app URL.

---

## 5. Configuration & Environment Variables

Create a `.env` file or export the following variables in your server execution space:

```bash
# Target email settings
EMAIL_TO=adn.pune@gmail.com
EMAIL_FROM=ADN Pune <onboarding@resend.dev>

# API Keys (For zero-dependency REST alerts)
RESEND_API_KEY=re_your_api_key_here

# Google Sheet webhook URL
GOOGLE_SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec

# Optional: SMTP fallback configuration (if nodemailer is installed)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

---

## 6. Implementation Source Files

### A. The Synchronizer: [sheets.js](file:///c:/Users/ayush/Downloads/flow/sheets.js)
```javascript
const https = require('https');
const url = require('url');

const GOOGLE_SHEET_WEBAPP_URL = process.env.GOOGLE_SHEET_WEBAPP_URL;

function syncToGoogleSheets(record) {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_SHEET_WEBAPP_URL) {
      console.warn('[Sheets Warning] GOOGLE_SHEET_WEBAPP_URL is not defined. Sheet sync skipped.');
      return resolve({ skipped: true });
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
      // Handles Google Apps Script 302 Found redirects automatically
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
          console.error('[Sheets Error] Google Web App status:', res.statusCode, responseBody);
          reject(new Error(`Google Web App returned HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(payload);
    req.end();
  } catch (err) {
    reject(err);
  }
}

module.exports = {
  syncToGoogleSheets
};
```

### B. The Email Alert: [email.js](file:///c:/Users/ayush/Downloads/flow/email.js)
```javascript
const https = require('https');

const EMAIL_TO = process.env.EMAIL_TO || 'adn.pune@gmail.com';
const EMAIL_FROM = process.env.EMAIL_FROM || 'ADN Pune <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function sendEmailViaResend(subject, htmlContent) {
  return new Promise((resolve, reject) => {
    if (!RESEND_API_KEY) {
      console.warn('[Email Warning] RESEND_API_KEY is not defined. Email dispatch skipped.');
      return resolve({ skipped: true });
    }

    const payload = JSON.stringify({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject: subject,
      html: htmlContent
    });

    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Email Success] Registration alert dispatched to ${EMAIL_TO}`);
          resolve(JSON.parse(body));
        } else {
          console.error('[Email Error] Resend API status:', res.statusCode, body);
          reject(new Error(`Resend API response failure: ${res.statusCode}`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(payload);
    req.end();
  });
}

async function sendNotification(subject, htmlContent) {
  try {
    const nodemailer = require('nodemailer');
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });

      await transporter.sendMail({ from: EMAIL_FROM, to: EMAIL_TO, subject, html: htmlContent });
      console.log(`[Email Success] SMTP alert sent to ${EMAIL_TO}`);
      return { success: true, transport: 'SMTP' };
    }
  } catch (err) {}

  return sendEmailViaResend(subject, htmlContent);
}

module.exports = {
  sendNotification
};
```
