# HOH Signature API

HTTP wrapper around the local email-signature MCP tool logic. Zapier calls POST, gets back download URL. User clicks URL, browser downloads HTML signature file.

No auth — open endpoints. Download links carry a random token in the filename, so they're unguessable even without a key.

## Endpoints

### POST /generate-signature
Headers: `Content-Type: application/json`

Body:
```json
{
  "employee_id": "SDPL191",
  "name": "Harsh Pandit",
  "title": "Sr. Executive - IT",
  "department": "IT",
  "email": "harsh.pandit@houseofhiranandani.com",
  "phone": "+91XXXXXXXXXX"
}
```
`phone` is optional — omit it and the signature just skips that line.

Response — always HTTP 200 (so Zapier doesn't need separate error-branch paths; check `success` in the body instead):
```json
{ "success": true, "filename": "sdpl191_harsh_pandit_a1b2c3d4e5f6.html", "download_url": "http://<host>/email-sign/signature/sdpl191_harsh_pandit_a1b2c3d4e5f6.html" }
```
On missing required fields or a write failure:
```json
{ "success": false, "error": "missing fields: employee_id, title" }
```

### GET /signature/:filename
Serves file with `Content-Disposition: attachment`, triggers download.

### GET /logs
Raw CSV — timestamp, employee_id, firstname, lastname, filename — one row per generation.

## Local run
```bash
npm install
cp .env.example .env   # fill PORT, BASE_URL
npm start
```

## VM deploy (pm2)
```bash
npm install -g pm2
npm install
# edit ecosystem.config.js: BASE_URL = your VM's public IP/domain (+ path prefix if behind nginx location block)
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # persist across reboot
```

## nginx behind a path prefix (e.g. /email-sign)
`proxy_pass` needs a **trailing slash** to strip the location prefix before forwarding — otherwise nginx forwards `/email-sign/generate-signature` as-is and the app 404s (it only knows `/generate-signature`).

```nginx
location /email-sign/ {
    proxy_pass http://127.0.0.1:3004/;   # <-- trailing slash strips /email-sign/
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
Note the trailing slash on **both** `location /email-sign/` and `proxy_pass .../`. Then set `BASE_URL=http://165.99.128.167/email-sign` in ecosystem.config.js so returned download_urls carry the right prefix. Reload nginx: `nginx -t && systemctl reload nginx`.

## Zapier wiring
1. Trigger: whatever kicks off signature creation (form submit, new row, etc).
2. Action: Webhooks by Zapier → POST → `http://<vm>/email-sign/generate-signature`, JSON body mapped from trigger fields.
3. Use `download_url` from the response in your next step (email, Slack message, etc). Clicking it downloads the .html signature.

## Files
- `server.js` — Express app, both endpoints, signature HTML template (ported from `index.ts`'s MCP tool)
- `package.json` — deps (`express` only)
- `ecosystem.config.js` — pm2 process config for VM
- `.env.example` — env var template
- `generated/` — output dir, created at runtime, gitignore this
- `signature-log.csv` — generation log, created at runtime, gitignore this
