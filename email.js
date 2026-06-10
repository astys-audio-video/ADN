const https = require('https');

// Configuration inputs
const EMAIL_TO = process.env.EMAIL_TO || 'adn.pune@gmail.com';
const EMAIL_FROM = process.env.EMAIL_FROM || 'ADN Pune <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

/**
 * Dispatch registration emails using Resend REST API (Zero-Dependency)
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML formatted message body
 * @returns {Promise<Object>} Resend response payload
 */
function sendEmailViaResend(subject, htmlContent) {
  return new Promise((resolve, reject) => {
    if (!RESEND_API_KEY) {
      console.warn('[Email Warning] RESEND_API_KEY is not defined. Email dispatch skipped.');
      return resolve({ skipped: true, reason: 'Missing RESEND_API_KEY' });
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
          console.error('[Email Error] Resend API returned status:', res.statusCode, body);
          reject(new Error(`Resend API response failure: ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Email Error] Network delivery failure:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Global notify dispatch wrapper (Falls back to Resend API if SMTP not active)
 */
async function sendNotification(subject, htmlContent) {
  // Check if SMTP is configured and nodemailer is locally installed
  try {
    const nodemailer = require('nodemailer');
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: EMAIL_FROM,
        to: EMAIL_TO,
        subject,
        html: htmlContent
      });

      console.log(`[Email Success] SMTP alert sent to ${EMAIL_TO}`);
      return { success: true, transport: 'SMTP' };
    }
  } catch (err) {
    // nodemailer is either not installed or SMTP environment variables are missing
  }

  // Fallback to Resend REST API
  return sendEmailViaResend(subject, htmlContent);
}

module.exports = {
  sendNotification
};
