const ALLOWED_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

function allowedClientIds() {
  return String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function reject(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function verifyGoogleIdToken(idToken) {
  const token = String(idToken || "").trim();
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    throw reject("Google did not return a valid sign-in token. Try again.", 400);
  }

  const allowed = allowedClientIds();
  if (allowed.length === 0) {
    throw reject(
      "Google sign-in is not set up yet. Add the Google client ID on the server, then try again.",
      503
    );
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.error) {
    throw reject("Google sign-in could not be verified. Try again.", 400);
  }

  if (!allowed.includes(String(payload.aud || ""))) {
    throw reject("This Google sign-in was not issued for Pagdagusan.", 400);
  }

  if (!ALLOWED_ISSUERS.has(String(payload.iss || ""))) {
    throw reject("Google sign-in could not be verified. Try again.", 400);
  }

  const expiresAt = Number(payload.exp);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
    throw reject("That Google sign-in expired. Try again.", 400);
  }

  if (String(payload.email_verified) !== "true") {
    throw reject("That Google account email is not verified.", 400);
  }

  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw reject("Google did not share an email for this account.", 400);
  }

  const rawName = String(payload.name || email.split("@")[0] || "").trim();
  const name = rawName.length >= 2 ? rawName.slice(0, 120) : "Google user";
  return { email, name };
}

module.exports = { verifyGoogleIdToken };
