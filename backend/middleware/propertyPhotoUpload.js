const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "property-photos");
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Phones label the same picture in more than one way (image/jpg, HEIC
// sequences, or no type at all). Anything declared as an image is accepted
// here; normalizePropertyPhoto then checks the real bytes.

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (_req, file, cb) => {
  const mime = (file.mimetype || "").toLowerCase();
  // iOS sometimes omits a MIME type or sends octet-stream. Accept those and
  // any image/* label, then let detectImageFormat() reject non-images.
  if (!mime || mime === "application/octet-stream" || mime.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file type. Use an image such as JPEG, PNG, HEIC, HEIF, WebP, or GIF."));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
});

// ─── Content detection & conversion ─────────────────────
// The MIME type sent by the client is a hint, not proof. Detect the real
// format from the file's magic bytes so we never trust the extension or the
// declared MIME type on its own.

const HEIF_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx",
  "heim", "heis", "hevm", "hevs",
  "mif1", "msf1",
  "avif", "avis",
]);

function detectImageFormat(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = fs.readSync(fd, buf, 0, 16, 0);
    if (bytesRead < 12) return "unknown";

    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf.readUInt32BE(0) === 0x89504e47) return "png";
    // WebP: RIFF....WEBP
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
    // GIF: GIF87a / GIF89a
    if (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a") return "gif";
    // HEIC/HEIF: ISO BMFF box with "ftyp" at offset 4 and an image brand
    if (buf.toString("ascii", 4, 8) === "ftyp") {
      const brand = buf.toString("ascii", 8, 12);
      if (HEIF_BRANDS.has(brand)) return "heif";
    }
    return "unknown";
  } finally {
    fs.closeSync(fd);
  }
}

// Extension + MIME each format is stored under. HEIF is always converted to
// JPEG so the stored file renders in <img>/expo-image on every client.
const CANONICAL_EXT = { jpeg: ".jpg", png: ".png", webp: ".webp", gif: ".gif", heif: ".jpg" };
const CANONICAL_MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heif: "image/jpeg" };

// Converts iPhone HEIC/HEIF uploads to JPEG before persistent storage (the
// prebuilt sharp binaries cannot decode the HEVC codec iPhones write, so we
// use heic-convert's WASM libheif which can). JPEG/PNG/WebP/GIF pass through
// untouched. Returns the final filename and updates file metadata.
async function normalizePropertyPhoto(file) {
  const detected = detectImageFormat(file.path);
  if (detected === "unknown") {
    throw new Error("Uploaded file is not a valid JPEG, PNG, HEIC, HEIF, WebP, or GIF image");
  }

  const dir = path.dirname(file.path);
  const currentExt = path.extname(file.filename).toLowerCase();

  if (detected === "heif") {
    const convert = require("heic-convert");
    const inputBuffer = fs.readFileSync(file.path);
    let jpegBuffer;
    try {
      jpegBuffer = await convert({ buffer: inputBuffer, format: "JPEG", quality: 0.9 });
    } catch (err) {
      throw new Error(`Could not convert HEIC/HEIF image: ${err.message}`);
    }
    const newName = `${path.basename(file.filename, currentExt)}${CANONICAL_EXT.heif}`;
    const newPath = path.join(dir, newName);
    fs.writeFileSync(newPath, jpegBuffer);
    fs.unlinkSync(file.path); // remove the original HEIC copy
    file.filename = newName;
    file.path = newPath;
    file.mimetype = CANONICAL_MIME.heif;
    return file.filename;
  }

  // Non-HEIF formats pass through without re-encoding (full quality). If the
  // extension doesn't match the real content, rename the file to match so the
  // stored URL always describes what is actually saved.
  const canonicalExt = CANONICAL_EXT[detected];
  if (currentExt !== canonicalExt) {
    const oldPath = file.path;
    const newName = `${path.basename(file.filename, currentExt)}${canonicalExt}`;
    const newPath = path.join(dir, newName);
    fs.renameSync(oldPath, newPath);
    file.filename = newName;
    file.path = newPath;
    file.mimetype = CANONICAL_MIME[detected];
  }
  return file.filename;
}

upload.normalizePropertyPhoto = normalizePropertyPhoto;

module.exports = upload;