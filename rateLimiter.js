const ipStore = {};
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes window
const MAX_REQUESTS = 5; // Max 5 submissions per IP within window

/**
 * Check if an IP address has exceeded registration submission rates.
 * @param {string} ip - Client IP
 * @returns {boolean} True if client is rate limited
 */
function isRateLimited(ip) {
  const now = Date.now();
  if (!ipStore[ip]) {
    ipStore[ip] = [];
  }

  // Retain only requests within the active window
  ipStore[ip] = ipStore[ip].filter(timestamp => now - timestamp < WINDOW_MS);

  if (ipStore[ip].length >= MAX_REQUESTS) {
    return true;
  }

  ipStore[ip].push(now);
  return false;
}

// Memory maintenance: prune stale records every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const ip in ipStore) {
    ipStore[ip] = ipStore[ip].filter(timestamp => now - timestamp < WINDOW_MS);
    if (ipStore[ip].length === 0) {
      delete ipStore[ip];
    }
  }
}, WINDOW_MS);

module.exports = {
  isRateLimited
};
