/* =============================================
   image-cache.js  –  Picture Talk Image Engine
   Speak Up! English Practice App

   This module manages the "Picture Talk" tab:
   - Fetches & pre-loads images from /api/images
   - Maintains a client pool for instant delivery
   - Crossfades between images inside #picture-display-area
   - Shows skeleton shimmer while loading
   - Completely independent from the word/topic tabs
   ============================================= */

const PictureTalk = (() => {

  // ─── CONSTANTS ──────────────────────────────────────────────────
  const POOL_SIZE       = 4;    // images to preload ahead of time
  const LOW_POOL_THRESH = 2;    // refill when pool drops below this
  const FETCH_TIMEOUT   = 9000; // ms before giving up on a fetch

  // ─── STATE ──────────────────────────────────────────────────────
  let pool         = [];    // { url, alt, category, color }
  let isFetching   = false;
  let activeLayer  = 'a';   // 'a' or 'b'
  let currentImage = null;
  let initialized  = false;

  // ─── DOM REFS (resolved lazily after DOM is ready) ──────────────
  const el = () => ({
    skeleton  : document.getElementById('picture-skeleton'),
    layerA    : document.getElementById('picture-layer-a'),
    layerB    : document.getElementById('picture-layer-b'),
    prompt    : document.getElementById('picture-speak-prompt'),
    catPill   : document.getElementById('picture-cat-label'),
  });

  // ─── FALLBACK IMAGES (no API key / quota exhausted) ─────────────
  const FALLBACKS = [
    { url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'mountain landscape', category: 'Nature' },
    { url: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'cosy cafe with coffee', category: 'Cafe' },
    { url: 'https://images.unsplash.com/photo-1543353071-087092ec393a?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'delicious meal plated beautifully', category: 'Food' },
    { url: 'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'golden retriever puppy', category: 'Pets' },
    { url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'technology circuit board', category: 'Technology' },
    { url: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'shelves full of library books', category: 'Books' },
    { url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'gym workout equipment', category: 'Fitness' },
    { url: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'aerial city skyline at dusk', category: 'City' },
    { url: 'https://images.unsplash.com/photo-1530099486328-e021101a494a?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'friends laughing at a park', category: 'Friendship' },
    { url: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'student studying at a desk', category: 'Education' },
    { url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'live music concert with crowd', category: 'Music' },
    { url: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'travel adventure landscape', category: 'Travel' },
    { url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'busy shopping street', category: 'Shopping' },
    { url: 'https://images.unsplash.com/photo-1487611459768-bd414656ea10?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'modern office workspace', category: 'Office' },
    { url: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1400&h=900&fit=crop&auto=format&q=80', alt: 'lifestyle travel photography', category: 'Lifestyle' },
  ];
  let fallbackIdx = Math.floor(Math.random() * FALLBACKS.length);

  // ─── FETCH ONE IMAGE FROM SERVER ────────────────────────────────
  async function fetchOne() {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch('/api/images', { signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      clearTimeout(tid);
      return null;
    }
  }

  // Pre-decode the image so it's cached by the browser before display
  function preload(imgData) {
    return new Promise(resolve => {
      if (!imgData) { resolve(null); return; }
      const img = new Image();
      img.onload  = () => resolve(imgData);
      img.onerror = () => resolve(null);
      img.src = imgData.url;
    });
  }

  // ─── POOL MANAGEMENT ────────────────────────────────────────────
  async function fillPool() {
    if (isFetching) return;
    isFetching = true;

    const needed = POOL_SIZE - pool.length;
    const promises = [];
    for (let i = 0; i < needed; i++) {
      promises.push(
        fetchOne().then(raw => preload(raw))
      );
    }
    const results = await Promise.all(promises);
    results.forEach(img => { if (img) pool.push(img); });

    console.log(`🖼️ PictureTalk pool: ${pool.length} ready`);
    isFetching = false;
  }

  function pickFromPool() {
    if (!pool.length) return null;
    const idx = Math.floor(Math.random() * pool.length);
    const img = pool.splice(idx, 1)[0];
    if (pool.length < LOW_POOL_THRESH) fillPool().catch(console.error);
    return img;
  }

  // Get a fallback image (cycles through the array)
  function getFallback() {
    const img = FALLBACKS[fallbackIdx % FALLBACKS.length];
    fallbackIdx++;
    return img;
  }

  // ─── SKELETON ───────────────────────────────────────────────────
  function showSkeleton() {
    const { skeleton, prompt } = el();
    if (skeleton) skeleton.classList.remove('hidden');
    if (prompt)   prompt.classList.add('hidden');
  }

  function hideSkeleton() {
    const { skeleton, prompt } = el();
    if (skeleton) skeleton.classList.add('hidden');
    if (prompt)   prompt.classList.remove('hidden');
  }

  // ─── CROSSFADE DISPLAY ──────────────────────────────────────────
  function applyImage(imgData) {
    const { layerA, layerB, catPill } = el();
    if (!layerA || !layerB) return;

    const nextLayer = activeLayer === 'a' ? 'b' : 'a';
    const nextEl    = nextLayer === 'a' ? layerA : layerB;
    const activeEl  = activeLayer === 'a' ? layerA : layerB;

    // Set the background on the incoming layer BEFORE fading it in
    nextEl.style.backgroundImage = `url(${imgData.url})`;
    // Small tick delay so the browser paints the background first
    requestAnimationFrame(() => {
      nextEl.classList.add('visible');
      activeEl.classList.remove('visible');
    });

    activeLayer = nextLayer;
    currentImage = imgData;

    // Update category pill
    if (catPill) {
      const cat = imgData.category || 'Photo';
      catPill.textContent = `📍 ${capitalize(cat)}`;
    }

    hideSkeleton();
  }

  // ─── PUBLIC API ─────────────────────────────────────────────────

  /** Call once when the user switches to Picture Talk tab */
  async function init() {
    if (initialized && currentImage) {
      // Already have an image, just make sure it's visible
      hideSkeleton();
      return;
    }
    initialized = true;
    showSkeleton();

    // Kick off pool fill in background
    fillPool().catch(console.error);

    // Fetch first image (could come from pool after fillPool, or direct fetch)
    const raw    = await fetchOne();
    const loaded = raw ? await preload(raw) : null;
    const img    = loaded || getFallback();
    // Make sure the layer is not pre-loaded yet
    applyImage(img);
  }

  /** Spin to next image — called when Spin button clicked in picture tab */
  async function next() {
    showSkeleton();

    let img = pickFromPool();
    if (!img) {
      // Pool empty — fetch synchronously with short timeout
      const raw = await fetchOne();
      img = raw ? await preload(raw) : null;
    }

    // Final fallback
    if (!img) img = getFallback();

    // Tiny delay so skeleton shimmer is visible for at least one frame
    setTimeout(() => applyImage(img), 80);
  }

  function getCurrent() { return currentImage; }

  // ─── UTIL ───────────────────────────────────────────────────────
  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  return { init, next, getCurrent };

})();

window.PictureTalk = PictureTalk;
