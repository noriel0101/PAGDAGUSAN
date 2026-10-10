// Builds a URL the requesting client can actually load.
// Photos are stored as a path (`/uploads/property-photos/...`) so a change of
// LAN IP never strands old rows on localhost. Absolute URLs already in the
// database (from earlier uploads) are rewritten onto the current request host.

function requestOrigin(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) return "";
  return `${proto}://${host}`;
}

function toStoredPhotoPath(filename) {
  return `/uploads/property-photos/${filename}`;
}

function toPublicPhotoUrl(req, stored) {
  if (!stored) return stored;
  const origin = requestOrigin(req);
  let pathname = stored;
  try {
    if (/^https?:\/\//i.test(stored)) {
      pathname = new URL(stored).pathname;
    }
  } catch {
    pathname = stored;
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (!origin) return pathname;
  return `${origin}${pathname}`;
}

module.exports = { requestOrigin, toStoredPhotoPath, toPublicPhotoUrl };
