# HOH Signature API

HTTP wrapper around the local email-signature MCP tool logic. Zapier calls POST, gets back download URL. User clicks URL, browser downloads HTML signature file.

## Endpoints

### POST /generate-signature
Headers: `X-API-Key: <your key>` (if API_KEY env set), `Content-Type: application/json`

Body:
```json
{
  "employee_id": "SDPL191",
  "name": "Harsh Pandit",
  "title": "Sr. Executive - IT",
  "department": "IT",
  "phone": "+91XXXXXXXXXX",
  "email": "harsh.pandit@houseofhiranandani.com"
}
```

Response:
```json
{ "filename": "sdpl191_harsh_pandit_a1b2c3d4e5f6.html", "download_url": "http://<host>:3000/signature/sdpl191_harsh_pandit_a1b2c3d4e5f6.html" }
```

### GET /signature/:filename
No auth (browser click can't send headers). Random token in filename is the guard — serves file with `Content-Disposition: attachment`, triggers download.

## Local run
```bash
npm install
cp .env.example .env   # fill API_KEY, BASE_URL
node -r dotenv/config server.js   # or export vars manually and `npm start`
```

## VM deploy (pm2)
```bash
npm install -g pm2
npm install
# edit ecosystem.config.js: API_KEY, BASE_URL = your VM's public IP/domain
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # persist across reboot
```
Open the PORT (default 3000) in VM firewall/security group. Put nginx + TLS in front if exposing beyond Zapier's IP ranges.

## Zapier wiring
1. Trigger: whatever kicks off signature creation (form submit, new row, etc).
2. Action: Webhooks by Zapier → POST → `http://<vm>:3000/generate-signature`, header `X-API-Key`, JSON body mapped from trigger fields.
3. Use `download_url` from the response in your next step (email, Slack message, etc). Clicking it downloads the .html signature.

## Files
- `server.js` — Express app, both endpoints, signature HTML template (ported from `index.ts`'s MCP tool)
- `package.json` — deps (`express` only)
- `ecosystem.config.js` — pm2 process config for VM
- `.env.example` — env var template
- `generated/` — output dir, created at runtime, gitignore this
