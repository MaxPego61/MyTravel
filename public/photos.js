let ITEMS = [];      // flat list of {type, name, thumbUrl, fullUrl, width, height}
let currentIndex = -1;
let GRAPH_TOKEN = null;   // kept around so the lightbox can request converted images on demand
let currentObjectUrl = null; // tracks the blob URL currently shown, so we can revoke it

function getFolderFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('folder'); // e.g. "2024/2024-06 Athens"
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('album-status');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  el.style.display = msg ? 'block' : 'none';
}

async function fetchAlbumItemsPaged(folderPath, token, onPage) {
  const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
  let url = `https://graph.microsoft.com/v1.0/me/drive/root:/Pictures/${encodedPath}:/children?$expand=thumbnails&$top=100`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Graph API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    onPage(data.value || []);
    url = data['@odata.nextLink'] || null;
  }
}

function mapGraphItem(item) {
  const isVideo = !!item.video;
  const isPhoto = !!item.image;
  if (!isVideo && !isPhoto) return null; // skip non-media files

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
    width,
    height,
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

function renderGallery(items) {
  const gallery = document.getElementById('river-gallery');
  gallery.innerHTML = '';
  appendItemsToGallery(items, 0);
}

// Adds tiles for newly-arrived items only, without touching tiles already
// in the DOM (so their thumbnails don't get re-fetched/re-rendered).
function appendItemsToGallery(items, startIndex) {
  const gallery = document.getElementById('river-gallery');
  const rowHeight = window.innerWidth <= 640 ? 130 : 220;

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

function showNext() {
  currentIndex = (currentIndex + 1) % ITEMS.length;
  renderLightboxContent();
}

function showPrev() {
  currentIndex = (currentIndex - 1 + ITEMS.length) % ITEMS.length;
  renderLightboxContent();
}

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

  // Free the previous blob URL, if any, before loading the next one
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

  // Photos: request a server-converted JPEG. This is what makes iPhone
  // .heic photos (unreadable by <img> in Chrome/Firefox/Edge) display
  // correctly everywhere, and it's lighter than the original file too.
  const loading = document.createElement('div');
  loading.style.color = '#4fc3f7';
  loading.textContent = 'Loading…';
  content.appendChild(loading);

  try {
    const blobUrl = await fetchLargeImageBlobUrl(item.id);
    currentObjectUrl = blobUrl;

    // Only apply if the user hasn't already navigated to another photo
    // while this was loading
    if (ITEMS[currentIndex] === item) {
      content.innerHTML = '';
      const img = document.createElement('img');
      img.src = blobUrl;
      img.alt = item.name;
      content.appendChild(img);
    }
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

async function loadAlbum(folderPath, token) {
  GRAPH_TOKEN = token;
  ITEMS = [];
  document.getElementById('river-gallery').innerHTML = '';
  document.getElementById('river-gallery').style.display = 'flex';
  setStatus('Loading photos…');

  try {
    await fetchAlbumItemsPaged(folderPath, token, (rawPage) => {
      const mapped = rawPage.map(mapGraphItem).filter(Boolean);
      if (mapped.length === 0) return;

      // Sort within this page so at least locally items appear in date
      // order; a full cross-page re-sort would mean re-rendering (and
      // re-fetching) every already-shown thumbnail on each new page.
      mapped.sort((a, b) => new Date(a.takenAt || 0) - new Date(b.takenAt || 0));

      const startIndex = ITEMS.length;
      ITEMS.push(...mapped);
      appendItemsToGallery(mapped, startIndex);

      setStatus(''); // clear "loading" as soon as the first items appear
    });

    if (ITEMS.length === 0) {
      setStatus('No photos or videos found in this album.');
    }
  } catch (err) {
    console.error('Photo album error:', err);
    setStatus(`Unable to load this album: ${err.message}`, true);
  }
}

function showSignInMessage() {
  document.getElementById('river-gallery').style.display = 'none';
  setStatus('');
  document.getElementById('album-status').innerHTML = `
    <p>You need to be signed in on the main MyTravel page first.</p>
    <p style="margin-top:10px;">
      <a href="/" target="_blank" style="color:#4fc3f7;">Open MyTravel and sign in</a>,
      then reopen this album.
    </p>
  `;
}

// Fallback for when this page is opened directly (bookmark, typed URL) rather
// than via the "Trip photos" button — tries the classic MSAL silent flow,
// which may hit the iframe/third-party-cookie limitations described above.
async function tryFallbackMsalToken() {
  await loadConfig();
  msalInstance = new msal.PublicClientApplication(getMsalConfig());
  await msalInstance.handleRedirectPromise();

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    showSignInMessage();
    return null;
  }

  try {
    return await getGraphToken();
  } catch (err) {
    console.error('Fallback token acquisition failed:', err);
    showSignInMessage();
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const folderPath = getFolderFromUrl();

  if (!folderPath) {
    setStatus('No album specified.', true);
    return;
  }

  document.getElementById('albumTitle').textContent = folderPath.split('/').pop();

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

  let handled = false;

  if (window.opener) {
    setStatus('Requesting access…');

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (handled) return;

      if (event.data?.type === 'graphToken') {
        handled = true;
        loadAlbum(folderPath, event.data.token);
      } else if (event.data?.type === 'graphTokenError') {
        handled = true;
        setStatus(`Unable to get access to OneDrive: ${event.data.message}`, true);
      }
    });

    // Tell the opener we're ready to receive the token
    window.opener.postMessage({ type: 'photosReady' }, window.location.origin);

    // Safety net: if no reply arrives quickly, fall back to the classic flow
    setTimeout(async () => {
      if (handled) return;
      handled = true;
      const token = await tryFallbackMsalToken();
      if (token) loadAlbum(folderPath, token);
    }, 4000);

  } else {
    // Opened directly, no opener to ask — go straight to the fallback
    tryFallbackMsalToken().then(token => {
      if (token) loadAlbum(folderPath, token);
    });
  }
});