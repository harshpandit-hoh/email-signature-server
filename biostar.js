// Ported from biostar.sh — same 3-step flow: create user -> upload photo -> extract & attach visual face template.

const SERVER_IP = process.env.BIOSTAR_SERVER_IP; // e.g. "185.15.209.134:5002"
const USERNAME = process.env.BIOSTAR_USERNAME;
const PASSWORD = process.env.BIOSTAR_PASSWORD;
const USER_GROUP_ID = process.env.BIOSTAR_USER_GROUP_ID || "3440";
const ACCESS_GROUP_ID = process.env.BIOSTAR_ACCESS_GROUP_ID || "2";

const DARWINBOX_API_KEY = process.env.DARWINBOX_API_KEY;
const DARWINBOX_USERNAME = process.env.DARWINBOX_USERNAME; // Basic Auth, not the api_key
const DARWINBOX_PASSWORD = process.env.DARWINBOX_PASSWORD;
const DARWINBOX_URL =
  "https://hoh.darwinbox.in/Employeedocs/downloadPersonalDocs";

function base() {
  return `https://${SERVER_IP}`;
}

// node's built-in global fetch is its own internal undici instance. Passing a dispatcher
// built from a separately require()'d 'undici' package into global fetch can silently no-op
// (different instance) -- cert check still applies -> generic "fetch failed" against a
// self-signed box. Fix: use undici's own fetch + its own Agent together, guaranteed compatible.
const { fetch: undiciFetch, Agent } = require("undici");
const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

async function biostarFetch(
  urlPath,
  { method = "GET", sessionId, body, rawHeaders } = {},
) {
  let res;
  try {
    res = await undiciFetch(`${base()}${urlPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "bs-session-id": sessionId } : {}),
        ...rawHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      dispatcher: insecureDispatcher,
    });
  } catch (err) {
    // surface the real network cause (ECONNREFUSED, cert error, DNS, timeout, etc.)
    // instead of undici's generic "fetch failed"
    const cause = err.cause
      ? ` (cause: ${err.cause.code || err.cause.message || err.cause})`
      : "";
    throw new Error(
      `BioStar request to ${urlPath} failed: ${err.message}${cause}`,
    );
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

// ---- Darwinbox: resolve employee_no -> a short-lived signed S3 URL for their profile pic ----
// URL expires in ~10 min (X-Amz-Expires=600), so the caller must download it immediately
// after this call, not stash it for later.
async function getProfilePicUrl(employeeNo) {
  if (!DARWINBOX_API_KEY || !DARWINBOX_USERNAME || !DARWINBOX_PASSWORD) {
    throw new Error(
      "DARWINBOX_API_KEY / DARWINBOX_USERNAME / DARWINBOX_PASSWORD not set in env",
    );
  }
  const basicAuth = Buffer.from(
    `${DARWINBOX_USERNAME}:${DARWINBOX_PASSWORD}`,
  ).toString("base64");

  let res;
  try {
    res = await undiciFetch(DARWINBOX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        api_key: DARWINBOX_API_KEY,
        employee_no: employeeNo,
        for: "profile_pic",
      }),
    });
  } catch (err) {
    const cause = err.cause
      ? ` (cause: ${err.cause.code || err.cause.message || err.cause})`
      : "";
    throw new Error(
      `Darwinbox profile pic request failed: ${err.message}${cause}`,
    );
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Darwinbox profile pic response not JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
    );
  }

  if (json.status !== 1 || !json.url) {
    throw new Error(
      `Darwinbox profile pic lookup failed for employee_no=${employeeNo}: ${JSON.stringify(json)}`,
    );
  }
  return json.url;
}

async function login() {
  if (!SERVER_IP || !USERNAME || !PASSWORD) {
    throw new Error(
      "BIOSTAR_SERVER_IP / BIOSTAR_USERNAME / BIOSTAR_PASSWORD not set in env",
    );
  }
  let res;
  try {
    res = await undiciFetch(`${base()}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        User: { login_id: USERNAME, password: PASSWORD },
      }),
      dispatcher: insecureDispatcher,
    });
  } catch (err) {
    const cause = err.cause
      ? ` (cause: ${err.cause.code || err.cause.message || err.cause})`
      : "";
    throw new Error(`BioStar login request failed: ${err.message}${cause}`);
  }
  const sessionId = res.headers.get("bs-session-id");
  if (!sessionId) {
    const text = await res.text();
    throw new Error(
      `BioStar login failed (HTTP ${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return sessionId;
}

// BioStar returns Response.code as a STRING ("0"), not a number -- strict === 0 always
// failed here even on real success. Normalize before comparing.
function ok(json) {
  return (
    json?.Response?.code !== undefined && String(json.Response.code) === "0"
  );
}

function bsCode(json) {
  return json?.Response?.code !== undefined ? String(json.Response.code) : null;
}

// Thrown by createUser specifically for BioStar code 212 ("E-mail already exists"), so
// callers can distinguish "this email is already registered under some other user_id"
// from every other create failure without string-matching the message.
class EmailExistsError extends Error {
  constructor(json) {
    super(`BioStar user create failed: ${JSON.stringify(json)}`);
    this.name = "EmailExistsError";
    this.biostarJson = json;
  }
}

async function getNextUserId(sessionId) {
  const { json } = await biostarFetch("/api/users/next_user_id", { sessionId });
  const id = json?.User?.user_id;
  if (!id) throw new Error("Failed to fetch next available BioStar user_id");
  return id;
}

async function userExists(sessionId, userId) {
  const { json } = await biostarFetch(`/api/users/${userId}`, { sessionId });
  return ok(json);
}

async function createUser(
  sessionId,
  {
    userId,
    name,
    email,
    department,
    title,
    phone,
    empCode,
    startDatetime,
    expiryDatetime,
  },
) {
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
  const { json } = await biostarFetch("/api/users", {
    method: "POST",
    sessionId,
    body: payload,
  });
  if (!ok(json)) {
    // code 212 = "E-mail already exists." -- the address is registered under a different
    // (usually auto-assigned) user_id than the one we tried. Signal this distinctly so
    // registerUser() can treat it as a soft success instead of a hard failure.
    if (bsCode(json) === "212") {
      throw new EmailExistsError(json);
    }
    throw new Error(`BioStar user create failed: ${JSON.stringify(json)}`);
  }
}

async function uploadProfilePhoto(sessionId, userId, photoBase64) {
  const payload = { User: { user_id: String(userId), photo: photoBase64 } };
  const { json } = await biostarFetch(`/api/users/${userId}`, {
    method: "PUT",
    sessionId,
    body: payload,
  });
  if (!ok(json)) {
    throw new Error(
      `BioStar profile photo upload failed: ${JSON.stringify(json)}`,
    );
  }
}

async function registerVisualFace(sessionId, userId, photoBase64) {
  // Step 3a: extract face template from the photo
  const step1 = await biostarFetch("/api/users/check/upload_picture", {
    method: "PUT",
    sessionId,
    body: { template_ex_picture: photoBase64 },
  });
  if (!ok(step1.json)) {
    throw new Error(
      `BioStar face extraction failed: ${JSON.stringify(step1.json)}`,
    );
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
          visualFaces: [
            { template_ex_normalized_image: normalizedImage, templates },
          ],
        },
      },
    },
  });
  if (!ok(step2.json)) {
    throw new Error(
      `BioStar face attach failed: ${JSON.stringify(step2.json)}`,
    );
  }
}

// Full flow. photoBase64 = raw base64 string (no data: prefix), matches bash's `base64 -w 0`.
async function registerUser({
  userId,
  name,
  email,
  department,
  title,
  phone,
  empCode,
  startDatetime,
  expiryDatetime,
  photoBase64,
}) {
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
    console.log(
      `[biostar] user_id ${userId} already exists, skipping creation`,
    );
    steps.user_created = false; // already existed, skipped creation like biostar.sh does
  } else {
    console.log(`[biostar] creating user_id ${userId} (${name})`);
    try {
      await createUser(sessionId, {
        userId,
        name,
        email,
        department,
        title,
        phone,
        empCode,
        startDatetime,
        expiryDatetime,
      });
      console.log(`[biostar] user_id ${userId} created`);
      steps.user_created = true;
    } catch (err) {
      if (err instanceof EmailExistsError) {
        // This email is already registered under some OTHER user_id (BioStar has no
        // "look up user by email" endpoint we're using, so we don't know which). The
        // user_id we picked/were given was never actually created, so there's nothing
        // valid to attach a photo or face template to -- short-circuit here as a soft
        // success rather than a hard 502, mirroring the face_registered:false pattern.
        console.warn(
          `[biostar] email already registered under a different user_id, treating as soft success: ${err.message}`,
        );
        steps.user_created = false;
        steps.already_existed = true;
        steps.photo_uploaded = false;
        steps.face_registered = false;
        steps.note = "email already registered under a different BioStar user_id; skipped photo/face upload";
        return steps;
      }
      throw err;
    }
  }

  console.log(
    `[biostar] uploading profile photo (${Math.round(photoBase64.length / 1024)}KB base64) for user_id ${userId}`,
  );
  await uploadProfilePhoto(sessionId, userId, photoBase64);
  console.log("[biostar] profile photo uploaded");
  steps.photo_uploaded = true;

  console.log("[biostar] extracting + attaching visual face template");
  await registerVisualFace(sessionId, userId, photoBase64);
  console.log("[biostar] visual face registered");
  steps.face_registered = true;

  return steps;
}

module.exports = { registerUser, getProfilePicUrl };