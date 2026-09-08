const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { registerUser } = require("./biostar");

const app = express();
app.use(express.json());

// ---- request logging: every hit, every route ----
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[req] ${req.method} ${req.originalUrl} from ${req.ip} content-type=${req.headers["content-type"] || "none"}`);
  res.on("finish", () => {
    console.log(`[res] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const GEN_DIR = path.join(__dirname, "generated");
const LOG_FILE = path.join(__dirname, "signature-log.csv");

// ---- logging ----
async function logGeneration({ employee_id, firstname, lastname, filename }) {
  const row = [
    new Date().toISOString(),
    employee_id,
    firstname,
    lastname,
    filename,
  ]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`)
    .join(",") + "\n";

  try {
    await fs.access(LOG_FILE);
  } catch {
    await fs.writeFile(LOG_FILE, "timestamp,employee_id,firstname,lastname,filename\n", "utf-8");
  }
  await fs.appendFile(LOG_FILE, row, "utf-8");
}

// ---- office address lookup, keyed by "location" param ----
// Ported from the old constants.js. Empty-string entries are intentional
// (no address on file for that location) -- those fall through to Powai too.
const LOCATIONS = {
  Andheri: "House of Hiranandani, Olympia, Central Avenue, Hiranandani Gardens, Powai, Mumbai - 400 076",
  Bannerghatta: "House of Hiranandani, 757/B, 100 Feet Road, Hal 2nd stage, Indiranagar, Bengaluru, Karnataka - 560 038",
  Beach: "",
  Bhiwandi: "House of Hiranandani, Olympia, Central Avenue, Hiranandani Gardens, Powai, Mumbai - 400076",
  Chembur: "Maitri Park, Union Park, Chembur, Mumbai, Maharashtra 400071",
  Chennai: "House of Hiranandani, No 5/63 Old Mahabalipuram Road, Egattur Village, Opp. to Siruseri IT Park, Thalambur Post, Dist. Chennai Chengalpattu, Tamil Nadu - 600130",
  Devanahalli: "House of Hiranandani, 757/B, 100 Feet Road, Hal 2nd stage, Indiranagar, Bengaluru, Karnataka - 560 038",
  Hebbal: "House of Hiranandani, 757/B, 100 Feet Road, Hal 2nd stage, Indiranagar, Bengaluru, Karnataka - 560 038",
  Hyderabad: "House Of Hiranandani, PLOT NO: 63 & 64, FLAT NO : 101 SHRI RESIDENCY, ALLURI SITARAMA RAJU NAGAR, MIYAPUR CHERUVU ROAD, MIYAPUR, HYDERABAD - 500049",
  Indiranagar: "House of Hiranandani, 757/B, 100 Feet Road, Hal 2nd stage, Indiranagar, Bengaluru, Karnataka - 560038",
  Kandivali: "House of Hiranandani, Castalia, New Link road, Dahanukar Wadi Signal, Kandivali (W), Mumbai - 400 067",
  Killick: "",
  Maharashtra: "",
  Maitri: "Maitri Park, Mumbai, Maharashtra, India, Chembur - 400071.",
  Meadows: "House of Hiranandani, North Point, Hiranandani Estate, Patlipada, Thane (W) - 400 607",
  North: "House of Hiranandani, North Point, Hiranandani Estate, Patlipada, Thane (W) - 400 607",
  OHP: "House of Hiranandani, North Point, Hiranandani Estate, Patlipada, Thane (W) - 400 607",
  Pogaon: "",
  Powai: "House of Hiranandani, Olympia, Central Avenue, Hiranandani Gardens, Powai, Mumbai - 400 076",
  Thane: "House of Hiranandani, North Point, Hiranandani Estate, Patlipada, Thane (W) - 400 607",
  "Gorai Site": "Shop No. 24, 25, Mangal Murti CHS Ltd, LT Rd, Opp. Maxus Cinemas, Gorai 3, Borivali West, Mumbai, Maharashtra 400091",
  "Gorai Sales": "Gorai Nagar, Borivali West, Mumbai, Maharashtra 400091"
};
const DEFAULT_LOCATION = "Powai";

function resolveAddress(location) {
  const address = location ? LOCATIONS[location] : undefined;
  // falls through to Powai when: no location given, location not in the list,
  // or the location maps to an empty string (no address on file for it)
  return address || LOCATIONS[DEFAULT_LOCATION];
}

// ---- template (unchanged from MCP tool) ----
function buildSignatureHtml({ name, title, department, phone, email, location }) {
  const officeAddress = resolveAddress(location);
  return `
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta http-equiv="content-type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0;">
    <style>
        body { margin: 0; padding: 0; min-width: 100%; width: 100% !important; height: 100% !important; }
        @media only screen and (min-width:320px) and (max-width:575px) {
            table { width: 100% !important; }
        }
    </style>
</head>
<body style="background-color: #FFFFFF; color: #000000; font-family: Helvetica, sans-serif;">
    <table cellpadding="0" cellspacing="0" border="0" style="font-size: 12px; color: #58595b; width: 650px;">
        <tbody>
            <tr>
                <td width="32%" align="center" valign="middle" style="padding: 0 10px;">
                    <a href="https://www.houseofhiranandani.com/" style="display: block; text-decoration: none;" target="_blank">
                        <img width="130" border="0" alt="Logo" src="https://www.houseofhiranandani.com/gmail_signature/signature_16-03-2024/images/hoh-new-logo.jpg" style="width: 100%; max-width: 190px;">
                    </a>
                </td>
                <td width="54%" valign="middle" style="padding: 20px 10px;">
                    <div style="line-height:20px;">
                        <strong style="color:#58595B; font-size:14px; font-weight:bold;">${name}</strong><br>
                        <span style="display:block; color:#58595B; font-size:12px;">${title} | ${department}</span>
                    </div>
                    <div style="line-height:20px; padding-bottom: 11px; border-bottom: #9fa0a2 1px solid;">
                        ${phone ? `<a href="tel:${phone}" style="color: #58595b; text-decoration: none;">${phone}</a><br />` : ""}
                        <a href="mailto:${email}" style="color: #58595b; text-decoration: none;" target="_blank">${email}</a>
                    </div>
                    <div style="line-height:18px; padding-top: 11px; color:#58595B;">
                        Office Address: ${officeAddress}<br>
                        <a href="https://www.houseofhiranandani.com/" style="color: #444; text-decoration: none;" target="_blank">houseofhiranandani.com</a>
                        <table style="display: contents;">
                            <tbody style="display: inline-flex; margin-top:5px;">
                                <tr><td valign="middle" style="padding-right:5px;"><a href="https://www.facebook.com/HouseofHiranandani" target="_blank"><img src="https://www.houseofhiranandani.com/gmail_signature/signature_16-03-2024/images/facebook.png" style="width: 15px;"></a></td></tr>
                                <tr><td valign="middle" style="padding-right:5px;"><a href="https://www.instagram.com/houseofhiranandani/" target="_blank"><img src="https://www.houseofhiranandani.com/gmail_signature/signature_16-03-2024/images/insta.png" style="width: 15px;"></a></td></tr>
                                <tr><td valign="middle" style="padding-right:5px;"><a href="https://www.youtube.com/channel/UC5b7xMV-q5ZIkJf0SxtlRdg" target="_blank"><img src="https://www.houseofhiranandani.com/gmail_signature/signature_16-03-2024/images/youtube-new.jpg" style="width: 16px; border-radius: 3px;"></a></td></tr>
                                <tr><td valign="middle" style="padding-right:5px;"><a href="https://www.linkedin.com/company/house-of-hiranandani" target="_blank"><img src="https://www.houseofhiranandani.com/gmail_signature/signature_16-03-2024/images/linkedin-new.jpg" style="width: 15px; border-radius: 3px;"></a></td></tr>
                                <tr><td valign="middle"><a href="https://twitter.com/HOHExclusive" target="_blank"><img src="https://www.houseofhiranandani.com/gmail_signature/signature_16-03-2024/images/x-new.jpg" style="width: 15px; border-radius: 3px;"></a></td></tr>
                            </tbody>
                        </table>
                    </div>
                </td>
            </tr>
        </tbody>
    </table>
</body>
</html>`;
}

function safeSlug(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ---- POST /generate-signature ----
// body: { employee_id, name, title, department, email, phone? }  phone optional
// returns: { download_url, filename }
app.post("/generate-signature", async (req, res) => {
  const { employee_id, name, title, department, phone, email, location } = req.body || {};
  const missing = ["employee_id", "name", "title", "department", "email"].filter(
    (k) => !req.body?.[k]
  );
  if (missing.length) {
    return res.status(200).json({ success: false, error: `missing fields: ${missing.join(", ")}` });
  }

  const nameParts = name.trim().split(/\s+/);
  const firstname = safeSlug(nameParts[0]);
  const lastname = nameParts.length > 1 ? safeSlug(nameParts[nameParts.length - 1]) : "";
  const empId = safeSlug(employee_id);

  // random token in filename -> download links unguessable even without API key
  const token = crypto.randomBytes(6).toString("hex");
  const fileName = `${empId}_${firstname}${lastname ? "_" + lastname : ""}_${token}.html`;
  const filePath = path.join(GEN_DIR, fileName);

  const html = buildSignatureHtml({ name, title, department, phone, email, location });

  try {
    await fs.mkdir(GEN_DIR, { recursive: true });
    await fs.writeFile(filePath, html, "utf-8");
  } catch (err) {
    return res.status(200).json({ success: false, error: "failed to write file", detail: err.message });
  }

  try {
    await logGeneration({ employee_id, firstname, lastname, filename: fileName });
  } catch (err) {
    console.error("log write failed:", err.message); // don't fail the request over this
  }

  return res.json({
    success: true,
    filename: fileName,
    download_url: `${BASE_URL}/signature/${fileName}`,
  });
});

// ---- GET /signature/:filename ----
// serves file with Content-Disposition: attachment -> click = download
app.get("/signature/:filename", async (req, res) => {
  const filename = req.params.filename;
  // guard against path traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).json({ error: "bad filename" });
  }
  const filePath = path.join(GEN_DIR, filename);

  try {
    await fs.access(filePath);
  } catch {
    return res.status(404).json({ error: "not found" });
  }

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.sendFile(filePath);
});

// ---- GET /logs ----
// returns raw CSV of every signature generated so far
app.get("/logs", async (req, res) => {
  try {
    await fs.access(LOG_FILE);
  } catch {
    return res.status(200).type("text/csv").send("timestamp,employee_id,firstname,lastname,filename\n");
  }
  res.type("text/csv");
  res.sendFile(LOG_FILE);
});

// BioStar rejects special characters in `department` (e.g. "&") -- error code 262172,
// "Department do not allow special characters. or up to 64 characters".
// Strip anything but letters/numbers/spaces, collapse whitespace, cap at 64 chars.
function sanitizeDepartment(dept) {
  return String(dept)
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

// ---- POST /biostar/register-user ----
// application/json. Fields: name, email, department, title (emp code), photo_url, phone?, user_id?
// Mirrors biostar.sh: create user (skip if exists) -> upload profile photo -> extract + attach visual face template
app.post("/biostar/register-user", async (req, res) => {
  const { name, email, department, title, phone, user_id, photo_url } = req.body || {};
  console.log("[biostar] body received:", JSON.stringify(req.body || {}));

  const missing = ["name", "email", "department", "title", "photo_url"].filter((k) => !req.body?.[k]);
  if (missing.length) {
    console.log(`[biostar] rejecting: missing ${missing.join(", ")}`);
    return res.status(400).json({ success: false, error: `missing fields: ${missing.join(", ")}` });
  }

  const now = new Date();
  const fiveYearsOut = new Date(now);
  fiveYearsOut.setFullYear(fiveYearsOut.getFullYear() + 5);

  try {
    console.log(`[biostar] fetching photo from ${photo_url}`);
    const photoRes = await fetch(photo_url);
    if (!photoRes.ok) {
      throw new Error(`photo_url fetch failed: HTTP ${photoRes.status}`);
    }
    const arrayBuffer = await photoRes.arrayBuffer();
    const photoBuffer = Buffer.from(arrayBuffer);
    if (photoBuffer.length > 8 * 1024 * 1024) {
      throw new Error(`photo too large: ${Math.round(photoBuffer.length / 1024 / 1024)}MB (max 8MB)`);
    }
    console.log(`[biostar] photo fetched: ${Math.round(photoBuffer.length / 1024)}KB, content-type=${photoRes.headers.get("content-type")}`);
    const photoBase64 = photoBuffer.toString("base64");

    console.log(`[biostar] starting registerUser for name="${name}" title="${title}" user_id="${user_id || "(auto)"}"`);
    const cleanDepartment = sanitizeDepartment(department);
    if (cleanDepartment !== department) {
      console.log(`[biostar] sanitized department "${department}" -> "${cleanDepartment}"`);
    }
    const steps = await registerUser({
      userId: user_id || "",
      name,
      email,
      department: cleanDepartment,
      title,
      phone,
      empCode: title, // biostar.sh maps Title and Emp Code to the same value
      startDatetime: now.toISOString().replace(/\.\d+Z$/, ".00Z"),
      expiryDatetime: fiveYearsOut.toISOString().replace(/\.\d+Z$/, ".00Z"),
      photoBase64,
    });
    console.log(`[biostar] success: ${JSON.stringify(steps)}`);
    return res.json({ success: true, ...steps });
  } catch (err) {
    console.error(`[biostar] failed: ${err.message}`);
    return res.status(502).json({ success: false, error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Signature API listening on port ${PORT}`);
});
