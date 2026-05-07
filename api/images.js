/**
 * api/images.js  –  Smart Cached Unsplash Image Service
 *
 * GET  /api/images          → returns one random image from cache
 * GET  /api/images?batch=1  → returns the full cached array (admin)
 * GET  /api/images?refill=1 → forces a cache refill
 *
 * Vercel keeps serverless function instances warm for a few minutes,
 * so the module-level `imageCache` array persists across requests
 * within the same instance – giving us free in-memory caching.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

// ─── DYNAMIC QUERY GENERATOR ───────────────────────────────────────────────
// Generates thousands of unique search combinations based on target themes

const VOCAB = {
  objects: ['teapot', 'backpack', 'camera', 'sneaker', 'coffee mug', 'book', 'plant', 'clock', 'chair', 'lamp', 'bicycle', 'guitar', 'headphones', 'sunglasses', 'watch', 'typewriter', 'vase'],
  objMods: ['ceramic', 'leather', 'vintage', 'modern', 'colorful', 'minimalist', 'wooden', 'glass', 'metallic', 'retro', 'elegant'],
  objCtx:  ['on plain background', 'isolated', 'still life', 'clean background', 'minimalism', 'hero shot', 'studio lighting'],

  scenes:  ['park', 'kitchen', 'airport terminal', 'cafe', 'street market', 'train station', 'office', 'classroom', 'subway', 'shopping mall', 'festival', 'gym'],
  scnMods: ['crowded', 'messy', 'busy', 'action packed', 'chaotic', 'bustling', 'lively', 'energetic'],



  memes:   ['funny slice of life', 'relatable human reaction', 'awkward situation funny', 'people laughing together', 'surprised face', 'bored at work', 'struggling with technology', 'pet doing something funny'],

  styles:  ['photorealistic', 'real photography', 'high quality photo', 'documentary photography']
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateDynamicQuery() {
  const type = Math.floor(Math.random() * 3); // Now 3 categories
  let query = '';
  
  if (type === 0) {
    query = `${pick(VOCAB.objMods)} ${pick(VOCAB.objects)} ${pick(VOCAB.objCtx)}`;
  } else if (type === 1) {
    query = `${pick(VOCAB.scnMods)} ${pick(VOCAB.scenes)} people`;
  } else {
    query = pick(VOCAB.memes);
  }
  
  // 30% chance to append a specific style constraint
  if (Math.random() < 0.3) {
    query += ` ${pick(VOCAB.styles)}`;
  }
  
  return query;
}

const BATCH_SIZE        = 50;   // how many images to fetch per refill
const LOW_CACHE_THRESH  = 10;   // trigger background refill below this
const PER_QUERY         = 5;    // images fetched per Unsplash query (max 30)
const IMAGE_WIDTH       = 1200; // Unsplash CDN resize param
const IMAGE_HEIGHT      = 800;

// ─── MODULE-LEVEL CACHE (persists across warm invocations) ──────────────────
let imageCache          = [];   // array of { url, alt, category, color }
let usedIndices         = new Set();
let isRefilling         = false;
let lastRefillAt        = 0;
const REFILL_COOLDOWN   = 60_000; // 1 min minimum between refills

// ─── FETCH HELPERS ─────────────────────────────────────────────────────────

async function fetchUnsplashQuery(query, count = PER_QUERY) {
  if (!UNSPLASH_KEY) return [];

  const page = 1 + Math.floor(Math.random() * 5); // randomise page for variety
  const url  = `https://api.unsplash.com/search/photos`
    + `?query=${encodeURIComponent(query)}`
    + `&per_page=${count}`
    + `&page=${page}`
    + `&orientation=landscape`
    + `&content_filter=high`;   // Unsplash content safety filter

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
    });
    if (!res.ok) {
      console.warn(`Unsplash query "${query}" failed: ${res.status}`);
      return [];
    }
    const json = await res.json();
    return (json.results || []).map(photo => ({
      url  : `${photo.urls.raw}&w=${IMAGE_WIDTH}&h=${IMAGE_HEIGHT}&fit=crop&auto=format&q=80`,
      alt  : photo.alt_description || query,
      color: photo.color || '#1a1a2e',
      category: query,
      id   : photo.id,
    }));
  } catch (e) {
    console.error('Unsplash fetch error:', e);
    return [];
  }
}

/**
 * Refill cache up to BATCH_SIZE images by rotating through categories.
 * Called once at cold-start and again when cache runs low.
 */
async function refillCache() {
  if (isRefilling) return;
  const now = Date.now();
  if (now - lastRefillAt < REFILL_COOLDOWN) return;

  isRefilling   = true;
  lastRefillAt  = now;

  console.log('🖼️  Refilling image cache…');

  // Generate unique dynamic queries
  const needed   = BATCH_SIZE - imageCache.length;
  const queries  = Math.ceil(needed / PER_QUERY);
  const selected = Array.from({ length: queries }, () => generateDynamicQuery());

  const results = await Promise.all(selected.map(q => fetchUnsplashQuery(q)));
  const newImgs = results.flat();

  // Deduplicate by id against existing cache
  const existingIds = new Set(imageCache.map(i => i.id));
  const fresh = newImgs.filter(img => img.id && !existingIds.has(img.id));

  imageCache = [...imageCache, ...fresh];
  // Cap total size to prevent unbounded growth
  if (imageCache.length > BATCH_SIZE * 2) {
    imageCache = imageCache.slice(-BATCH_SIZE);
  }
  usedIndices.clear(); // reset rotation when cache is refreshed

  console.log(`✅  Image cache now has ${imageCache.length} images.`);
  isRefilling = false;
}

/**
 * Pick a random image that hasn't been served recently.
 * When all images have been used, reset the rotation.
 */
function pickImage() {
  if (!imageCache.length) return null;

  const available = imageCache
    .map((img, i) => i)
    .filter(i => !usedIndices.has(i));

  if (!available.length) {
    usedIndices.clear();
    return pickImage();
  }

  const idx = available[Math.floor(Math.random() * available.length)];
  usedIndices.add(idx);
  return imageCache[idx];
}

// ─── FALLBACK IMAGES (used when Unsplash key is absent or quota exhausted) ──
// These are stable Unsplash "source" URLs — no key required, no quota.
const FALLBACK_IMAGES = [
  { url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&h=800&fit=crop', alt: 'mountain landscape', category: 'nature', color: '#4a90d9' },
  { url: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&h=800&fit=crop', alt: 'cosy cafe', category: 'cafe', color: '#8B6F47' },
  { url: 'https://images.unsplash.com/photo-1543353071-087092ec393a?w=1200&h=800&fit=crop', alt: 'delicious food', category: 'food', color: '#e07b39' },
  { url: 'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=1200&h=800&fit=crop', alt: 'cute dog', category: 'pets', color: '#c9a96e' },
  { url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&h=800&fit=crop', alt: 'technology circuit', category: 'technology', color: '#2c3e50' },
  { url: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=1200&h=800&fit=crop', alt: 'library books', category: 'books', color: '#8B4513' },
  { url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&h=800&fit=crop', alt: 'gym fitness', category: 'fitness', color: '#2c2c2c' },
  { url: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&h=800&fit=crop', alt: 'aerial city view', category: 'city', color: '#1a2a4a' },
  { url: 'https://images.unsplash.com/photo-1530099486328-e021101a494a?w=1200&h=800&fit=crop', alt: 'friends laughing', category: 'friendship', color: '#f39c12' },
  { url: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1200&h=800&fit=crop', alt: 'student studying', category: 'education', color: '#3498db' },
  { url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&h=800&fit=crop', alt: 'music concert', category: 'music', color: '#8e44ad' },
  { url: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=1200&h=800&fit=crop', alt: 'travel adventure', category: 'travel', color: '#16a085' },
];

// ─── HANDLER ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Force refill if requested or first cold start
  if (req.query.refill === '1' || imageCache.length === 0) {
    await refillCache();
  }

  // Async background refill when cache is running low (non-blocking)
  if (imageCache.length < LOW_CACHE_THRESH && !isRefilling) {
    refillCache().catch(console.error); // fire-and-forget
  }

  // Return full batch for admin/debug
  if (req.query.batch === '1') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ count: imageCache.length, images: imageCache });
  }

  // Return a single image
  const img = UNSPLASH_KEY ? pickImage() : null;

  if (!img) {
    // Serve a fallback (no key or empty cache)
    const fallback = FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ...fallback, source: 'fallback' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ...img, source: 'unsplash', cacheSize: imageCache.length });
}
