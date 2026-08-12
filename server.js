const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const app = express();
app.use(express.json());

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

// ---- template (unchanged from MCP tool) ----
function buildSignatureHtml({ name, title, department, phone, email }) {
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
                        <span style="display:block; color:#58595B; font-size:12px;">${title} - ${department}</span>
                    </div>
                    <div style="line-height:20px; padding-bottom: 11px; border-bottom: #9fa0a2 1px solid;">
                        ${phone ? `<a href="tel:${phone}" style="color: #58595b; text-decoration: none;">${phone}</a><br />` : ""}
                        <a href="mailto:${email}" style="color: #58595b; text-decoration: none;" target="_blank">${email}</a>
                    </div>
                    <div style="line-height:18px; padding-top: 11px; color:#58595B;">
                        Office Address: House of Hiranandani, Olympia, Central Avenue, Hiranandani Gardens, Powai, Mumbai - 400 076<br>
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
  const { employee_id, name, title, department, phone, email } = req.body || {};
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

  const html = buildSignatureHtml({ name, title, department, phone, email });

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

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Signature API listening on port ${PORT}`);
});
