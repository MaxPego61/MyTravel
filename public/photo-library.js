// library.js — File-Explorer-style tree over the OneDrive \FOTO and \Pictures
// roots, with a photo/video gallery pane on the right for whatever folder is
// selected. Built as a sibling of photos.js/photos.html and reuses its
// token-handoff (postMessage from the opener window) and lightbox code
// almost verbatim — see photos.js for the original comments on those parts.

const ROOTS = ['FOTO', 'Pictures'];

let GRAPH_TOKEN = null;
let ITEMS = [];          // flat list for the currently open folder (lightbox needs this)
let currentIndex = -1;
let currentObjectUrl = null;

function setStatus(msg, isError = false) {
  const el = document.getElementById('lib-status');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  el.style.display = msg ? 'block' : 'none';
}

function encodePath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

// Generic paged Graph listing for one folder. `onlyFolders` filters out
// files (used by the tree); leaving it false returns everything (used by
// the gallery pane, which then filters for photo/video itself).
async function fetchChildrenPaged(path, token, onlyFolders, onPage) {
  const filter = onlyFolders ? '&$filter=folder ne null' : '&$expand=thumbnails';
  let url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodePath(path)}:/children?$top=200${filter}`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Graph API error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    onPage(data.value || []);
    url = data['@odata.nextLink'] || null;
  }
}

async function fetchSubfolders(path, token) {
  const folders = [];
  await fetchChildrenPaged(path, token, true, (page) => {
    folders.push(...page.filter(i => i.folder).map(i => i.name));
  });
  // Alphabetical, with numeric-aware comparison so "2024-09" sorts after
  // "2024-08" rather than by character code (which would put "10" before "2").
  folders.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return folders;
}

// ---------- Tree ----------

function makeNode(name, path, depth) {
  const li = document.createElement('div');
  li.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${8 + depth * 4}px`;
  row.innerHTML = `
    <span class="chevron">&#9656;</span>
    <span class="folder-icon">&#128193;</span>
    <span class="folder-name">${name}</span>
  `;
  li.appendChild(row);

  const childrenEl = document.createElement('div');
  childrenEl.className = 'tree-children';
  li.appendChild(childrenEl);

  let loaded = false;
  let expanded = false;

  row.addEventListener('click', async (e) => {
    e.stopPropagation();

    document.querySelectorAll('.tree-row.selected').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
    selectFolder(path, name);

    expanded = !expanded;
    row.classList.toggle('expanded', expanded);
    childrenEl.classList.toggle('open', expanded);
    if (!expanded || loaded) return;

    row.classList.add('loading');
    try {
      const subfolders = await fetchSubfolders(path, GRAPH_TOKEN);
      subfolders.forEach(sub => {
        childrenEl.appendChild(makeNode(sub, `${path}/${sub}`, depth + 1));
      });
      loaded = true;
    } catch (err) {
      console.error('Failed to load subfolders for', path, err);
      childrenEl.innerHTML = `<div style="padding:4px 8px; color:#ff8a80; font-size:12px;">Failed to load</div>`;
    } finally {
      row.classList.remove('loading');
    }
  });

  return li;
}

function buildTree() {
  const tree = document.getElementById('lib-tree');
  tree.innerHTML = '';
  ROOTS.forEach(root => tree.appendChild(makeNode(root, root, 0)));
}

// ---------- Gallery pane ----------

function mapGraphItem(item) {
  const isVideo = !!item.video;
  const isPhoto = !!item.image;
  if (!isVideo && !isPhoto) return null;

  const thumb = item.thumbnails?.[0]?.large?.url
             || item.thumbnails?.[0]?.medium?.url
             || item['@microsoft.graph.downloadUrl'];

  const width = (isVideo ? item.video.width : item.image?.width) || 800;
  const height = (isVideo ? item.video.height : item.image?.height) || 600;

  return {
    id: item.id,
    type: isVideo ? 'video' : 'photo',
    name: item.name,
    thumbUrl: thumb,
    fullUrl: item['@microsoft.graph.downloadUrl'],
    width, height,
    durationMs: isVideo ? item.video.duration : null,
    takenAt: item.photo?.takenDateTime || item.fileSystemInfo?.createdDateTime || item.createdDateTime
  };
}

function formatDuration(ms) {
  if (!ms) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function appendItemsToGallery(items, startIndex) {
  const gallery = document.getElementById('lib-gallery');
  const rowHeight = window.innerWidth <= 640 ? 170 : 200;

  items.forEach((item, i) => {
    const index = startIndex + i;
    const aspect = item.width / item.height;
    const tile = document.createElement('div');
    tile.className = 'river-item';
    tile.style.width = `${Math.round(rowHeight * aspect)}px`;

    const img = document.createElement('img');
    img.src = item.thumbUrl;
    img.loading = 'lazy';
    img.alt = item.name;
    tile.appendChild(img);

    if (item.type === 'video') {
      const badge = document.createElement('div');
      badge.className = 'play-badge';
      badge.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
      tile.appendChild(badge);
      if (item.durationMs) {
        const dur = document.createElement('div');
        dur.className = 'duration-badge';
        dur.textContent = formatDuration(item.durationMs);
        tile.appendChild(dur);
      }
    }

    tile.onclick = () => openLightbox(index);
    gallery.appendChild(tile);
  });
}

async function selectFolder(path, name) {
  document.getElementById('lib-breadcrumb').innerHTML =
    path.split('/').map((p, i, arr) => i === arr.length - 1 ? `<b>${p}</b>` : p).join(' / ');

  ITEMS = [];
  const gallery = document.getElementById('lib-gallery');
  gallery.innerHTML = '';
  setStatus('Loading…');

  try {
    await fetchChildrenPaged(path, GRAPH_TOKEN, false, (rawPage) => {
      const mapped = rawPage.map(mapGraphItem).filter(Boolean);
      if (mapped.length === 0) return;
      mapped.sort((a, b) => new Date(a.takenAt || 0) - new Date(b.takenAt || 0));
      const startIndex = ITEMS.length;
      ITEMS.push(...mapped);
      appendItemsToGallery(mapped, startIndex);
      setStatus('');
    });
    if (ITEMS.length === 0) setStatus('No photos or videos in this folder.');
  } catch (err) {
    console.error('Folder load error:', err);
    setStatus(`Unable to load this folder: ${err.message}`, true);
  }
}

// ---------- Lightbox (same behaviour as photos.js) ----------

function openLightbox(index) {
  currentIndex = index;
  renderLightboxContent();
  document.getElementById('lightbox').classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
  document.getElementById('lbContent').innerHTML = '';
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function showNext() { currentIndex = (currentIndex + 1) % ITEMS.length; renderLightboxContent(); }
function showPrev() { currentIndex = (currentIndex - 1 + ITEMS.length) % ITEMS.length; renderLightboxContent(); }

async function fetchLargeImageBlobUrl(itemId) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/thumbnails/0/c1920x1920/content`,
    { headers: { Authorization: `Bearer ${GRAPH_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`Thumbnail conversion failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function renderLightboxContent() {
  const item = ITEMS[currentIndex];
  const content = document.getElementById('lbContent');
  content.innerHTML = '';

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  if (item.type === 'video') {
    const video = document.createElement('video');
    video.src = item.fullUrl;
    video.controls = true;
    video.autoplay = true;
    content.appendChild(video);
    return;
  }

  // Show the thumbnail we already have (fetched for the grid, so usually
  // already in the browser cache) immediately as a stand-in, instead of a
  // blank "Loading…" pause. It's slightly soft since it's upscaled, hence
  // the blur — that hides the pixelation better than showing it sharp.
  const preview = document.createElement('img');
  preview.className = 'lb-preview';
  preview.src = item.thumbUrl;
  preview.alt = item.name;
  content.appendChild(preview);

  try {
    const blobUrl = await fetchLargeImageBlobUrl(item.id);
    currentObjectUrl = blobUrl;
    if (ITEMS[currentIndex] !== item) return; // user already swiped away

    // Pre-decode off-DOM so the swap to full-res is instant, not another
    // blank flash while this new image loads.
    const full = new Image();
    full.alt = item.name;
    full.onload = () => {
      if (ITEMS[currentIndex] !== item) return;
      content.innerHTML = '';
      content.appendChild(full);
    };
    full.src = blobUrl;
  } catch (err) {
    console.error('Image conversion failed, falling back to original file:', err);
    if (ITEMS[currentIndex] === item) {
      content.innerHTML = '';
      const img = document.createElement('img');
      img.src = item.fullUrl;
      img.alt = item.name;
      content.appendChild(img);
    }
  }
}

function showSignInMessage() {
  document.getElementById('lib-tree').style.display = 'none';
  document.getElementById('lib-content').style.display = 'none';
  setStatus('');
  document.getElementById('lib-status').innerHTML = `
    <p>You need to be signed in on the main MyTravel page first.</p>
    <p style="margin-top:10px;">
      <a href="/" target="_blank" style="color:#4fc3f7;">Open MyTravel and sign in</a>,
      then reopen the library.
    </p>
  `;
  document.getElementById('lib-status').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('lbClose').onclick = closeLightbox;
  document.getElementById('lbNext').onclick = showNext;
  document.getElementById('lbPrev').onclick = showPrev;

  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (document.getElementById('lightbox').classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') showNext();
    if (e.key === 'ArrowLeft') showPrev();
  });

  // Touch swipe left/right to move between photos on mobile.
  let touchStartX = null;
  let touchStartY = null;

  document.getElementById('lightbox').addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }, { passive: true });

  document.getElementById('lightbox').addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    touchStartX = null;
    touchStartY = null;

    // Require a clearly horizontal, deliberate gesture so an accidental
    // tap or a vertical scroll attempt doesn't also flip the photo.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) showNext(); else showPrev();
  }, { passive: true });

  let handled = false;

  function requestTokenFromOpener() {
    handled = false;
    setStatus('Requesting access…');
    window.opener.postMessage({ type: 'libraryReady' }, window.location.origin);

    setTimeout(() => {
      if (handled) return;
      handled = true;
      setStatus('');
      document.getElementById('lib-status').innerHTML = `
        <p>Taking longer than expected to get access to OneDrive.</p>
        <p style="margin-top:10px;">
          <button id="retryBtn" style="padding:8px 16px; cursor:pointer;">Retry</button>
        </p>
      `;
      document.getElementById('lib-status').style.display = 'block';
      document.getElementById('retryBtn').onclick = requestTokenFromOpener;
    }, 12000);
  }

  if (window.opener) {
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (handled) return;

      if (event.data?.type === 'graphToken') {
        handled = true;
        GRAPH_TOKEN = event.data.token;
        setStatus('');
        buildTree();
      } else if (event.data?.type === 'graphTokenError') {
        handled = true;
        setStatus(`Unable to get access to OneDrive: ${event.data.message}`, true);
      }
    });

    requestTokenFromOpener();
  } else {
    showSignInMessage();
  }
});