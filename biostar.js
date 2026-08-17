// Ported from biostar.sh — same 3-step flow: create user -> upload photo -> extract & attach visual face template.

const SERVER_IP = process.env.BIOSTAR_SERVER_IP; // e.g. "185.15.209.134:5002"
const USERNAME = process.env.BIOSTAR_USERNAME;
const PASSWORD = process.env.BIOSTAR_PASSWORD;
const USER_GROUP_ID = process.env.BIOSTAR_USER_GROUP_ID || "3440";
const ACCESS_GROUP_ID = process.env.BIOSTAR_ACCESS_GROUP_ID || "2";

function base() {
  return `https://${SERVER_IP}`;
}

// node's built-in fetch (undici) refuses self-signed certs by default.
// biostar.sh uses curl -k (insecure) because this hits a local/self-signed BioStar box.
// undici needs its own Agent passed as `dispatcher` -- a plain https.Agent is ignored by fetch.
const { Agent } = require("undici");
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

async function biostarFetch(urlPath, { method = "GET", sessionId, body, rawHeaders } = {}) {
  const res = await fetch(`${base()}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionId ? { "bs-session-id": sessionId } : {}),
      ...rawHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    dispatcher: insecureDispatcher,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function login() {
  if (!SERVER_IP || !USERNAME || !PASSWORD) {
    throw new Error("BIOSTAR_SERVER_IP / BIOSTAR_USERNAME / BIOSTAR_PASSWORD not set in env");
  }
  const res = await fetch(`${base()}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ User: { login_id: USERNAME, password: PASSWORD } }),
    dispatcher: insecureDispatcher,
  });
  const sessionId = res.headers.get("bs-session-id");
  if (!sessionId) {
    const text = await res.text();
    throw new Error(`BioStar login failed: ${text.slice(0, 300)}`);
  }
  return sessionId;
}

async function getNextUserId(sessionId) {
  const { json } = await biostarFetch("/api/users/next_user_id", { sessionId });
  const id = json?.User?.user_id;
  if (!id) throw new Error("Failed to fetch next available BioStar user_id");
  return id;
}

async function userExists(sessionId, userId) {
  const { json } = await biostarFetch(`/api/users/${userId}`, { sessionId });
  return json?.Response?.code === 0;
}

async function createUser(sessionId, { userId, name, email, department, title, phone, empCode, startDatetime, expiryDatetime }) {
  const payload = {
    User: {
      user_id: String(userId),
      name,
      email,
      department,
      user_title: title,
      phone: phone || "",
      user_group_id: { id: USER_GROUP_ID },
      access_groups: [{ id: ACCESS_GROUP_ID }],
      start_datetime: startDatetime,
      expiry_datetime: expiryDatetime,
      disabled: false,
      user_custom_fields: [{ item: empCode, custom_field: { id: "1" } }],
    },
  };
  const { json } = await biostarFetch("/api/users", { method: "POST", sessionId, body: payload });
  if (json?.Response?.code !== 0) {
    throw new Error(`BioStar user create failed: ${JSON.stringify(json)}`);
  }
}

async function uploadProfilePhoto(sessionId, userId, photoBase64) {
  const payload = { User: { user_id: String(userId), photo: photoBase64 } };
  const { json } = await biostarFetch(`/api/users/${userId}`, { method: "PUT", sessionId, body: payload });
  if (json?.Response?.code !== 0) {
    throw new Error(`BioStar profile photo upload failed: ${JSON.stringify(json)}`);
  }
}

async function registerVisualFace(sessionId, userId, photoBase64) {
  // Step 3a: extract face template from the photo
  const step1 = await biostarFetch("/api/users/check/upload_picture", {
    method: "PUT",
    sessionId,
    body: { template_ex_picture: photoBase64 },
  });
  if (step1.json?.Response?.code !== 0) {
    throw new Error(`BioStar face extraction failed: ${JSON.stringify(step1.json)}`);
  }

  const normalizedImage = step1.json.image;
  const tpl1 = step1.json.image_template;
  const tpl2 = step1.json.image_template_2;

  const templates = [];
  if (tpl1) templates.push({ credential_bin_type: "5", template_ex: tpl1 });
  if (tpl2) templates.push({ credential_bin_type: "9", template_ex: tpl2 });

  // Step 3b: attach the extracted template to the user
  const step2 = await biostarFetch(`/api/users/${userId}`, {
    method: "PUT",
    sessionId,
    body: {
      User: {
        credentials: {
          visualFaces: [{ template_ex_normalized_image: normalizedImage, templates }],
        },
      },
    },
  });
  if (step2.json?.Response?.code !== 0) {
    throw new Error(`BioStar face attach failed: ${JSON.stringify(step2.json)}`);
  }
}

// Full flow. photoBase64 = raw base64 string (no data: prefix), matches bash's `base64 -w 0`.
async function registerUser({ userId, name, email, department, title, phone, empCode, startDatetime, expiryDatetime, photoBase64 }) {
  console.log("[biostar] logging in to", SERVER_IP);
  const sessionId = await login();
  console.log("[biostar] session acquired");
  const steps = {};

  if (!userId) {
    userId = await getNextUserId(sessionId);
    console.log("[biostar] auto-assigned next user_id:", userId);
  }
  steps.user_id = userId;

  const exists = await userExists(sessionId, userId);
  if (exists) {
    console.log(`[biostar] user_id ${userId} already exists, skipping creation`);
    steps.user_created = false; // already existed, skipped creation like biostar.sh does
  } else {
    console.log(`[biostar] creating user_id ${userId} (${name})`);
    await createUser(sessionId, { userId, name, email, department, title, phone, empCode, startDatetime, expiryDatetime });
    console.log(`[biostar] user_id ${userId} created`);
    steps.user_created = true;
  }

  console.log(`[biostar] uploading profile photo (${Math.round(photoBase64.length / 1024)}KB base64) for user_id ${userId}`);
  await uploadProfilePhoto(sessionId, userId, photoBase64);
  console.log("[biostar] profile photo uploaded");
  steps.photo_uploaded = true;

  console.log("[biostar] extracting + attaching visual face template");
  await registerVisualFace(sessionId, userId, photoBase64);
  console.log("[biostar] visual face registered");
  steps.face_registered = true;

  return steps;
}

module.exports = { registerUser };
