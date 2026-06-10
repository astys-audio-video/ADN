// Load environment variables from .env file if it exists (Vanilla fallback for older Node versions)
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envData = fs.readFileSync(envPath, 'utf8');
    envData.split(/\r?\n/).forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        if (key && !key.startsWith('#')) {
          process.env[key] = value;
        }
      }
    });
  }
} catch (err) {
  console.warn('[Warning] Failed to load .env file:', err.message);
}

const cluster = require('cluster');
const http = require('http');
const numCPUs = require('os').cpus().length;

// Check if running inside Vercel serverless functions
const isServerless = process.env.VERCEL || process.env.NOW_REGION;

if (cluster.isMaster && !isServerless) {
  console.log(`[Master] Process ${process.pid} is running`);
  
  // Spawns server worker instances for each CPU core for horizontal scaling
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // If a worker crashes, reboot a new one immediately
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[Master] Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Reviving worker...`);
    cluster.fork();
  });
} else {
  startWorkerServer();
}

function startWorkerServer() {
  const fs = require('fs').promises;
  const path = require('path');
  const crypto = require('crypto');
  const storage = require('./storage');
  const rateLimiter = require('./rateLimiter');

  const PORT = process.env.PORT || 3000;
  const MAX_PAYLOAD_SIZE = 50 * 1024; // 50KB payload ceiling to prevent memory overflow

  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const server = http.createServer(async (req, res) => {
    const { method, url } = req;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Secure HTTP response headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; frame-ancestors 'none';");

    // 1. API: Process Registration Form Submissions
    if (method === 'POST' && url === '/api/register') {
      const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');

      // Helper to respond with error based on client capability
      const respondWithError = (statusCode, errMsg) => {
        if (acceptsHtml) {
          res.writeHead(302, { 'Location': `/?error=${encodeURIComponent(errMsg)}#register` });
          return res.end();
        } else {
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: errMsg }));
        }
      };

      // Helper to respond with success
      const respondWithSuccess = () => {
        if (acceptsHtml) {
          res.writeHead(302, { 'Location': '/?success=true#register' });
          return res.end();
        } else {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Registration submitted successfully!' }));
        }
      };

      // Anti-Spam Rate Limiting
      if (rateLimiter.isRateLimited(ip)) {
        return respondWithError(429, 'Too many attempts. Please try again in 15 minutes.');
      }

      let body = '';
      let isTooLarge = false;

      req.on('data', chunk => {
        body += chunk.toString();
        if (body.length > MAX_PAYLOAD_SIZE) {
          isTooLarge = true;
          req.destroy(); // Terminate request
        }
      });

      req.on('end', async () => {
        if (isTooLarge) {
          return respondWithError(413, 'Payload too large.');
        }

        try {
          const contentType = req.headers['content-type'] || '';
          let data = {};

          if (contentType.includes('application/json')) {
            data = JSON.parse(body);
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            data = Object.fromEntries(new URLSearchParams(body));
          } else {
            return respondWithError(400, 'Unsupported Content-Type header.');
          }

          const { full_name, firm_name, profession, mobile, city, website, meetup_interest, email_honeypot, csrf_token } = data;

          // Anti-Spam Honeypot check
          if (email_honeypot) {
            console.warn(`[Spam Blocked] Bot submission detected via honeypot from IP ${ip}`);
            return respondWithSuccess(); // Fake success response to deflect bots
          }

          // CSRF Token Validation
          const cookies = parseCookies(req.headers.cookie);
          const serverCsrfCookie = cookies['CSRF-Token'];

          if (!csrf_token || !serverCsrfCookie || csrf_token !== serverCsrfCookie) {
            return respondWithError(403, 'Session validation failed. Please refresh the page.');
          }

          // Validate Required Fields
          if (!full_name || !firm_name || !profession || !mobile || !city || !meetup_interest) {
            return respondWithError(400, 'All fields are required.');
          }

          // Mobile Format Validation (Allowing standard international digits/spaces/dashes)
          const mobileRegex = /^[+]?[0-9\s\-]{8,20}$/;
          if (!mobileRegex.test(mobile)) {
            return respondWithError(400, 'Please enter a valid mobile number.');
          }

          // Save to append-only JSONL DB
          await storage.saveRegistration({
            full_name,
            firm_name,
            profession,
            mobile,
            city,
            website,
            meetup_interest
          });

          return respondWithSuccess();
        } catch (err) {
          console.error(`[Error] Registration failed:`, err);
          return respondWithError(400, 'Invalid data payload structure.');
        }
      });
      return;
    }

    // 2. Static File Serving
    if (method === 'GET') {
      // Clean and normalize requested path to prevent directory traversal
      const safeUrl = path.normalize(url === '/' ? '/template.html' : url).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(__dirname, safeUrl);

      // Hard check for file safety bounds
      if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Forbidden');
      }

      try {
        let content = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        let contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // Dynamic CSRF/Toast Injection for main landing page without changing template.html on disk
        if (safeUrl === '/template.html' || safeUrl === '\\template.html') {
          const csrfToken = crypto.randomBytes(24).toString('hex');
          res.setHeader('Set-Cookie', `CSRF-Token=${csrfToken}; HttpOnly; SameSite=Strict; Path=/`);

          let html = content.toString('utf-8');

          // Inject CSRF token meta tag
          html = html.replace('</head>', `<meta name="csrf-token" content="${csrfToken}"></head>`);

          // Inject CSRF hidden token & honeypot field dynamically into the form
          const replacementFormTag = `<form action="/api/register" method="POST">
        <input type="hidden" name="csrf_token" value="${csrfToken}" />
        <div style="display:none;" aria-hidden="true">
          <input type="text" name="email_honeypot" tabindex="-1" autocomplete="off" />
        </div>`;
          html = html.replace(/<form\s+action="[^"]*"\s+method="POST">/i, replacementFormTag);

          // Inject user toast feedback script dynamically at the end of the body
          const feedbackToastScript = `
<script>
  window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('success') || params.has('error')) {
      const isSuccess = params.has('success');
      const message = isSuccess ? 'Registration submitted successfully!' : params.get('error');
      
      const toast = document.createElement('div');
      toast.style.position = 'fixed';
      toast.style.bottom = '24px';
      toast.style.right = '24px';
      toast.style.backgroundColor = isSuccess ? '#10b981' : '#ef4444';
      toast.style.color = '#ffffff';
      toast.style.padding = '14px 22px';
      toast.style.borderRadius = '6px';
      toast.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)';
      toast.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      toast.style.fontSize = '14px';
      toast.style.fontWeight = '500';
      toast.style.zIndex = '9999';
      toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      toast.style.transform = 'translateY(20px)';
      toast.style.opacity = '0';
      toast.textContent = message;
      
      document.body.appendChild(toast);
      
      // Trigger show transition
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });

      // Automatically slide out and clean up URL
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 400);
      }, 4500);

      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
  });
</script>
</body>`;
          html = html.replace('</body>', feedbackToastScript);

          content = Buffer.from(html, 'utf-8');
        }

        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(content);
      } catch (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Not Found');
        }
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Internal Server Error');
      }
    }

    // Unhandled paths/HTTP methods
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
  });

  server.listen(PORT, () => {
    console.log(`[Worker ${process.pid}] server listening at http://localhost:${PORT}`);
  });

  function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
  }
}
