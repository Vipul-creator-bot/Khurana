const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PUBLIC_IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}
ensureDir(path.join(PUBLIC_IMAGES_DIR, 'products'));
ensureDir(path.join(PUBLIC_IMAGES_DIR, 'categories'));
ensureDir(path.join(PUBLIC_IMAGES_DIR, 'how-it-works'));

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

// Images are saved under public/images/<type>/, matching the same folder
// the server already serves statically at /images/... (see server.js) — so
// an uploaded file is immediately reachable at a stable URL with no extra
// wiring, and reuses the exact convention documented for manually-added
// images in the README.
function folderFor(type) {
  if (type === 'categories') return 'categories';
  if (type === 'how-it-works') return 'how-it-works';
  return 'products';
}

function createUploader(type) {
  const folder = folderFor(type);
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(PUBLIC_IMAGES_DIR, folder)),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const base = slugify(req.body.name || 'image');
      const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      cb(null, `${base}-${unique}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 10 }, // 8MB per file, up to 10 files per request
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed.'));
      }
      cb(null, true);
    },
  });
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const uploadProductImages = createUploader('products');
const uploadCategoryImages = createUploader('categories');
const uploadHowItWorksImage = createUploader('how-it-works');

// Converts saved file objects (from req.files) into the public URL paths
// that get stored in a product/category's `images` array (or a How It
// Works step's `image` field).
function filesToPublicUrls(files, type) {
  const folder = folderFor(type);
  return (files || []).map((f) => `/images/${folder}/${f.filename}`);
}

module.exports = { uploadProductImages, uploadCategoryImages, uploadHowItWorksImage, filesToPublicUrls };
