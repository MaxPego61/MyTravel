let ITEMS = [];      // flat list of {type, name, thumbUrl, fullUrl, width, height}
let currentIndex = -1;

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

async function fetchAlbumItems(folderPath) {
  const token = await getGraphToken();
  const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/Pictures/${encodedPath}:/children?$expand=thumbnails&$top=200`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.value || [];
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

  const rowHeight = window.innerWidth <= 640 ? 130 : 220;

  items.forEach((item, index) => {
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
}

function showNext() {
  currentIndex = (currentIndex + 1) % ITEMS.length;
  renderLightboxContent();
}

function showPrev() {
  currentIndex = (currentIndex - 1 + ITEMS.length) % ITEMS.length;
  renderLightboxContent();
}

function renderLightboxContent() {
  const item = ITEMS[currentIndex];
  const content = document.getElementById('lbContent');
  content.innerHTML = '';

  if (item.type === 'video') {
    const video = document.createElement('video');
    video.src = item.fullUrl;
    video.controls = true;
    video.autoplay = true;
    content.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = item.fullUrl;
    img.alt = item.name;
    content.appendChild(img);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const folderPath = getFolderFromUrl();

  if (!folderPath) {
    setStatus('No album specified.', true);
    return;
  }

  document.getElementById('albumTitle').textContent = folderPath.split('/').pop();

  await loadConfig();
  msalInstance = new msal.PublicClientApplication(getMsalConfig());

  try {
    await msalInstance.handleRedirectPromise();

    const accounts = msalInstance.getAllAccounts();
    if (accounts.length === 0) {
      // No cached session found even in localStorage — rather than starting an
      // interactive redirect from here (which would land back on the main app
      // and lose this album's context), ask the user to sign in there first.
      document.getElementById('river-gallery').style.display = 'none';
      setStatus('');
      document.getElementById('album-status').innerHTML = `
        <p>You need to be signed in on the main MyTravel page first.</p>
        <p style="margin-top:10px;">
          <a href="/" target="_blank" style="color:#4fc3f7;">Open MyTravel and sign in</a>,
          then reopen this album.
        </p>
      `;
      return;
    }

    setStatus('Loading photos…');
    const rawItems = await fetchAlbumItems(folderPath);
    ITEMS = rawItems.map(mapGraphItem).filter(Boolean);

    // Chronological order
    ITEMS.sort((a, b) => new Date(a.takenAt || 0) - new Date(b.takenAt || 0));

    if (ITEMS.length === 0) {
      setStatus('No photos or videos found in this album.');
      return;
    }

    setStatus('');
    renderGallery(ITEMS);

  } catch (err) {
    console.error('Photo album error:', err);
    setStatus(`Unable to load this album: ${err.message}`, true);
  }

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
});