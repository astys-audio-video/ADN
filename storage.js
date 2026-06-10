const fs = require('fs').promises;
const path = require('path');
const email = require('./email');
const sheets = require('./sheets');

const FILE_PATH = path.join(__dirname, 'registrations.jsonl');

/**
 * Save a registration record by appending to a JSONL file.
 * @param {Object} data - Input registration data
 * @returns {Promise<Object>} The sanitized and stored record
 */
async function saveRegistration(data) {
  const record = {
    id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
    full_name: sanitizeString(data.full_name),
    firm_name: sanitizeString(data.firm_name),
    profession: sanitizeString(data.profession),
    mobile: sanitizeString(data.mobile),
    city: sanitizeString(data.city),
    website: sanitizeString(data.website || ''),
    meetup_interest: sanitizeString(data.meetup_interest),
    // Future-proofing: capture email or other fields if added later
    email: data.email ? sanitizeString(data.email) : undefined,
    created_at: new Date().toISOString()
  };

  // Convert to JSON Lines format (one JSON object per line)
  // This is highly performant O(1) write and prevents concurrency lockups
  const line = JSON.stringify(record) + '\n';
  await fs.appendFile(FILE_PATH, line, 'utf-8');

  // Trigger background dispatches asynchronously (fire-and-forget, so user does not wait)
  const emailSubject = `ADN Pune: New Member Application (${record.full_name})`;
  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
      <h2 style="color: #111; border-bottom: 2px solid #111; padding-bottom: 10px;">New Member Application</h2>
      <p style="font-size: 16px; color: #555;">A new user has submitted a registration application for the <strong>Architects & Designers Network (ADN) Pune Chapter</strong>.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <tr style="background-color: #f9f9f9;">
          <th style="text-align: left; padding: 10px; border: 1px solid #eee;">Field</th>
          <th style="text-align: left; padding: 10px; border: 1px solid #eee;">Submitted Value</th>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #eee; font-weight: bold;">Full Name</td>
          <td style="padding: 10px; border: 1px solid #eee;">${record.full_name}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #eee; font-weight: bold;">Firm / Studio</td>
          <td style="padding: 10px; border: 1px solid #eee;">${record.firm_name}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #eee; font-weight: bold;">Profession</td>
          <td style="padding: 10px; border: 1px solid #eee;">${record.profession}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #eee; font-weight: bold;">Mobile / WhatsApp</td>
          <td style="padding: 10px; border: 1px solid #eee;">${record.mobile}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #eee; font-weight: bold;">City</td>
          <td style="padding: 10px; border: 1px solid #eee;">${record.city}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #eee; font-weight: bold;">Instagram / Website</td>
          <td style="padding: 10px; border: 1px solid #eee;">${record.website ? `<a href="${record.website.startsWith('http') ? record.website : `https://${record.website}`}">${record.website}</a>` : 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #eee; font-weight: bold;">Meetup Interest</td>
          <td style="padding: 10px; border: 1px solid #eee;">${record.meetup_interest}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #eee; font-weight: bold;">Submitted At</td>
          <td style="padding: 10px; border: 1px solid #eee;">${record.created_at}</td>
        </tr>
      </table>
      
      <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #999;">
        <p>This is an automated notification from ADN Pune Registration Server.</p>
      </div>
    </div>
  `;

  // Dispatch asynchronous triggers (fire-and-forget style to not slow down user response)
  email.sendNotification(emailSubject, emailHtml).catch(err => {
    console.error('[Background Trigger Error] Email alert dispatch failed:', err.message);
  });

  sheets.syncToGoogleSheets(record).catch(err => {
    console.error('[Background Trigger Error] Google Sheets sync failed:', err.message);
  });

  return record;
}

/**
 * Sanitizes strings to prevent HTML injections/XSS
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .substring(0, 500) // Truncate to prevent buffer/memory flooding
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

module.exports = {
  saveRegistration
};
