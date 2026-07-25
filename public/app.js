let map;
let polylines = [];
let cityMarkers = {};
let showLines = true;
let showMarkers = true;
let TRIPS = [];

// Convert YYYY-MM-DD → valid Date
function parseDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr);
}

// Called by Google Maps once the script is ready (window.initMap)
async function realInitMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 4,
    center: { lat: 47.0, lng: 5.0 },
    mapId: "c72de03b2c069089"
  });

  try {
    const res = await fetch('/api/trips');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    TRIPS = data.trips || data; // supports both {trips:[...]} and a direct [...] array
  } catch (err) {
    console.error("Error loading trips:", err);
    document.getElementById("tripList").innerHTML =
      `<p style="color:#ff8a80;">Unable to load trip data. Please try again later.</p>`;
    return;
  } finally {
    const loading = document.getElementById("map-loading");
    if (loading) loading.style.display = "none";
  }

  populateFilters();

  document.getElementById("toggleLines").onclick = () => {
    showLines = !showLines;
    document.getElementById("toggleLines").textContent = showLines ? "Routes ON" : "Routes OFF";
    document.getElementById("toggleLines").classList.toggle("active");
    renderMap();
  };

  document.getElementById("toggleMarkers").onclick = () => {
    showMarkers = !showMarkers;
    document.getElementById("toggleMarkers").textContent = showMarkers ? "Markers ON" : "Markers OFF";
    document.getElementById("toggleMarkers").classList.toggle("active");
    renderMap();
  };

  document.getElementById("searchBox").oninput = renderAll;

  renderAll();
}

// Compatibility with the global window.initMap callback defined in index.html/script.js
window.initMap = function () {
  if (typeof realInitMap === "function") realInitMap();
};

function populateFilters() {
  const years = [...new Set(TRIPS.map(t => t.year))].sort((a, b) => b - a);
  const yearSel = document.getElementById("yearFilter");
  years.forEach(y => yearSel.innerHTML += `<option value="${y}">${y}</option>`);

  const companions = [...new Set(TRIPS.flatMap(t => t.companions || []))].sort();
  const compSel = document.getElementById("companionFilter");
  companions.forEach(c => compSel.innerHTML += `<option>${c}</option>`);

  yearSel.onchange = compSel.onchange = renderAll;
}

function getFilteredTrips() {
  let f = TRIPS;
  const y = document.getElementById("yearFilter").value;
  const c = document.getElementById("companionFilter").value;
  const q = (document.getElementById("searchBox").value || "").trim().toLowerCase();

  if (y) f = f.filter(t => t.year == y);
  if (c) f = f.filter(t => t.companions?.includes(c));
  if (q) {
    f = f.filter(t =>
      t.tripName.toLowerCase().includes(q) ||
      t.legs.some(l => (l.arrival.city || "").toLowerCase().includes(q))
    );
  }
  return f;
}

function renderAll() {
  const trips = getFilteredTrips();
  updateStats(trips);
  renderTripList(trips);
  renderMap(trips);
}

function updateStats(trips) {
  const totalTrips = trips.length;
  const totalFlights = trips.reduce((s, t) => s + t.legs.filter(l => l.type === 'flight').length, 0);
  const totalKm = trips.reduce((s, t) => s + t.legs.reduce((k, l) => k + (l.distanceKm || 0), 0), 0);
  const totalCountries = new Set(
    trips.flatMap(t => t.legs.filter(l => !l.isTransit).map(l => l.arrival.country))
  ).size;

  document.getElementById("totalTrips").textContent = totalTrips;
  document.getElementById("totalFlights").textContent = totalFlights.toLocaleString();
  document.getElementById("totalKm").textContent = Math.round(totalKm).toLocaleString();
  document.getElementById("totalCountries").textContent = totalCountries;
}

function renderTripList(trips) {
  const list = document.getElementById("tripList");
  list.innerHTML = "";
  trips.forEach(trip => {
    const flights = trip.legs.filter(l => l.type === 'flight').length;
    const cities = [...new Set(trip.legs.filter(l => !l.isTransit && !["Milan", "Origgio"].includes(l.arrival.city)).map(l => l.arrival.city))];

    let days = 0;
    let startDateStr = "";
    let endDateStr = "";

    if (trip.legs.length > 0) {
      const firstLeg = trip.legs[0];
      const lastLeg = trip.legs[trip.legs.length - 1];

      startDateStr = firstLeg.departure.date;
      endDateStr = lastLeg.arrival.date;

      const startDate = parseDate(startDateStr);
      const endDate = parseDate(endDateStr);

      if (startDate && endDate) {
        const diffTime = Math.abs(endDate - startDate);
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      }
    }

    const div = document.createElement("div");
    div.className = "trip-item";
    div.innerHTML = `
      ${icon(trip.legs.some(l => l.type === 'land') ? 'car' : 'plane')}
      <div class="details">
        <strong>${trip.tripName}</strong>
        <div>${formatDateRange(startDateStr, endDateStr)}</div>
        <div>${flights} flights • ${days} day${days !== 1 ? 's' : ''}</div>
        <div>${cities.slice(0, 3).join(', ')}${cities.length > 3 ? '…' : ''}</div>
      </div>
    `;
    div.onclick = (event) => showTripDetails(trip, event);
    list.appendChild(div);
  });
}

function renderMap(trips = getFilteredTrips()) {
  if (document.querySelector('.trip-item.active')) return;

  clearMap();
  const bounds = new google.maps.LatLngBounds();
  const cityCount = {};

  trips.forEach(trip => {
    trip.legs.forEach(leg => {
      if (!leg.departure.lat || !leg.arrival.lat) return;

      const dep = { lat: leg.departure.lat, lng: leg.departure.lng };
      const arr = { lat: leg.arrival.lat, lng: leg.arrival.lng };

      if (!leg.isTransit && !["Milan", "Origgio"].includes(leg.arrival.city)) {
        cityCount[leg.arrival.city] = (cityCount[leg.arrival.city] || 0) + 1;
      }

      if (showLines) {
        const color = leg.type === 'flight' ? '#d32f2f' : '#2e7d32';
        const line = new google.maps.Polyline({
          path: [dep, arr],
          geodesic: true,
          strokeColor: color,
          strokeOpacity: leg.isTransit ? 0.65 : 0.9,
          strokeWeight: 2,
          map: map
        });
        polylines.push(line);
      }

      bounds.extend(dep);
      bounds.extend(arr);
    });
  });

  const pinSvg = (color) => `
    <svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 10 13 23 13 23s13-13 13-23c0-7.2-5.8-13-13-13z"
            fill="${color}" stroke="white" stroke-width="2"/>
    </svg>
  `;

  Object.entries(cityCount).forEach(([city, count]) => {
    const leg = trips.flatMap(t => t.legs).find(l => !l.isTransit && l.arrival.city === city);
    if (!leg) return;

    const container = document.createElement("div");
    container.className = "pin-container";

    const svg = document.createElement("div");
    svg.className = "pin-svg";
    svg.innerHTML = pinSvg("#ff9800");
    container.appendChild(svg);

    const number = document.createElement("div");
    number.className = "pin-number";
    number.textContent = count;
    container.appendChild(number);

    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: { lat: leg.arrival.lat, lng: leg.arrival.lng },
      map: showMarkers ? map : null,
      content: container,
      title: `${city} – ${count} visit${count !== 1 ? 's' : ''}`
    });

    marker.addListener("click", () => {
      const c = marker.content;
      c.classList.add("marker-tap-feedback");
      setTimeout(() => c.classList.remove("marker-tap-feedback"), 600);
      if (window.innerWidth <= 900) {
        document.documentElement.classList.add("sidebar-open-right");
        document.documentElement.classList.remove("sidebar-open-left");
      }
      showCityDetails(city, trips);
    });

    cityMarkers[city] = marker;
  });

  if (!bounds.isEmpty()) map.fitBounds(bounds);
}

function clearMap() {
  polylines.forEach(p => p.setMap(null));
  polylines = [];
  Object.values(cityMarkers).forEach(m => {
    if (m.map) m.map = null;
  });
  cityMarkers = {};
}

function formatDateRange(start, end) {
  if (!start) return "–";
  const ds = new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!end || start === end) return ds;
  return ds + " → " + new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function showTripDetails(trip, event) {
  document.querySelectorAll('.trip-item').forEach(el => el.classList.remove('active'));
  if (event) event.target.closest('.trip-item').classList.add('active');

  renderMap([trip]);
  drawTripWithNumberedMarkers(trip);

  let html = `<h2>${trip.tripName}</h2>`;
  if (trip.companions.length) html += `<p>With: ${trip.companions.join(', ')}</p>`;

  let prevArrival = null;
  html += '<div class="legs">';

  trip.legs.forEach(leg => {
    const depTime = leg.departure.time || "00:00:00";
    const isLateDeparture = depTime >= "12:00:00";

    if (prevArrival && !prevArrival.isTransit) {
      const arrivalDay = parseDate(prevArrival.date);
      const departureDay = parseDate(leg.departure.date);
      const dayDiff = Math.floor((departureDay - arrivalDay) / 86400000);

      const arrivalFull = parseDate(prevArrival.date + " " + (prevArrival.arrTime || "00:00:00"));
      const departureFull = parseDate(leg.departure.date + " " + depTime);
      const hoursDiff = (departureFull - arrivalFull) / (1000 * 60 * 60);

      if (hoursDiff >= 4) {
        const totalStay = dayDiff + (isLateDeparture ? 1 : 0);
        if (totalStay > 0 && !["Milan", "Origgio"].includes(prevArrival.city)) {
          html += `<div class="leg-item stay">
            ${icon('home')} Stay in <strong>${prevArrival.city}</strong>: ${totalStay} day${totalStay !== 1 ? 's' : ''}
          </div>`;
        }
      }
    }

    const iconName = leg.isTransit ? "exchange" : (leg.type === 'flight' ? "plane" : "car");
    const colorClass = leg.isTransit ? "transit" : "";

    html += `<div class="leg-item ${colorClass}">
      ${icon(iconName)} ${formatDateTime(leg.departure)} → ${formatDateTime(leg.arrival)}<br>
      <small>${leg.arrival.city} • ${leg.distanceKm ? Math.round(leg.distanceKm) + ' km' : ''}${leg.isTransit ? ' (transit)' : ''}</small>
    </div>`;

    prevArrival = {
      date: leg.arrival.date,
      arrTime: leg.arrival.time || "00:00:00",
      city: leg.arrival.city,
      isTransit: leg.isTransit
    };
  });

  if (prevArrival && !prevArrival.isTransit && !["Milan", "Origgio"].includes(prevArrival.city)) {
    html += `<div class="leg-item stay">
      ${icon('flag')} End of trip in <strong>${prevArrival.city}</strong>
    </div>`;
  }

  html += '</div>';

  if (trip.notes && trip.notes.trim() !== "") {
    html += `
      <div class="notes-section">
        <div class="notes-content">${trip.notes.trim()}</div>
      </div>
    `;
  }

  // Phase 2: photo gallery — opens photos.html in a new window
  if (trip.photoFolder) {
    html += `
      <button class="photo-btn" data-photo-folder="${trip.photoFolder.replace(/"/g, '&quot;')}">
        ${icon('camera')} Trip photos
      </button>
    `;
  }

  document.getElementById("details-content").innerHTML = html;

  const photoBtn = document.querySelector('.photo-btn');
  if (photoBtn) {
    photoBtn.onclick = () => openPhotoPage(photoBtn.dataset.photoFolder);
  }
}

function drawTripWithNumberedMarkers(trip) {
  clearMap();

  const bounds = new google.maps.LatLngBounds();
  const citySteps = {};

  trip.legs.forEach((leg, i) => {
    if (!leg.departure.lat || !leg.arrival.lat) return;

    const dep = { lat: leg.departure.lat, lng: leg.departure.lng };
    const arr = { lat: leg.arrival.lat, lng: leg.arrival.lng };

    const color = leg.type === 'flight' ? '#d32f2f' : '#2e7d32';
    const line = new google.maps.Polyline({
      path: [dep, arr],
      geodesic: true,
      strokeColor: color,
      strokeOpacity: leg.isTransit ? 0.65 : 0.9,
      strokeWeight: leg.type === 'flight' ? 2 : 3,
      map: map
    });
    polylines.push(line);

    const city = leg.arrival.city;
    if (!citySteps[city]) citySteps[city] = [];
    citySteps[city].push(i + 1);

    bounds.extend(dep);
    bounds.extend(arr);
  });

  const pinSvg = (color) => `
    <svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 10 13 23 13 23s13-13 13-23c0-7.2-5.8-13-13-13z"
            fill="${color}" stroke="white" stroke-width="2"/>
    </svg>
  `;

  Object.entries(citySteps).forEach(([city, steps]) => {
    const leg = trip.legs.find(l => l.arrival.city === city);
    if (!leg) return;

    const labelText = steps.length === 1 ? String(steps[0]) : steps.join(',');

    const container = document.createElement("div");
    container.className = "pin-container";

    const svg = document.createElement("div");
    svg.className = "pin-svg";
    svg.innerHTML = pinSvg(leg.isTransit ? "#888888" : "#4fc3f7");
    container.appendChild(svg);

    const number = document.createElement("div");
    number.className = "pin-number";
    number.textContent = labelText;
    container.appendChild(number);

    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: { lat: leg.arrival.lat, lng: leg.arrival.lng },
      map: showMarkers ? map : null,
      content: container,
      title: `${city} – stop ${steps.join(', ')}`
    });

    cityMarkers[`sel_${city}`] = marker;
  });

  if (!bounds.isEmpty()) map.fitBounds(bounds);
}

function formatDateTime(obj) {
  if (!obj || !obj.date) return '–';
  const d = parseDate(obj.date);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return obj.time ? `${dateStr} ${obj.time.slice(0, 5)}` : dateStr;
}

function formatDate(d) {
  if (!d) return '–';
  return parseDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function showCityDetails(city, trips) {
  const visits = [];

  trips.forEach(trip => {
    let currentStay = null;

    trip.legs.forEach(leg => {
      if (!leg.isTransit && leg.arrival.city === city) {
        currentStay = {
          trip: trip,
          startDate: leg.arrival.date,
          startTime: leg.arrival.time || "00:00:00"
        };
      }

      if (currentStay && leg.departure.city === city) {
        const endDate = leg.departure.date;
        const endTime = leg.departure.time || "00:00:00";

        const start = parseDate(currentStay.startDate);
        const end = parseDate(endDate);

        let days = Math.floor((end - start) / 86400000) + 1;
        if (endTime < "12:00:00") days -= 1;
        days = Math.max(1, days);

        visits.push({
          trip: currentStay.trip,
          arrivalDate: currentStay.startDate,
          days: days
        });

        currentStay = null;
      }
    });
  });

  visits.sort((a, b) => parseDate(b.arrivalDate) - parseDate(a.arrivalDate));

  let html = `<h2>${city}</h2>`;
  html += `<p>Visited <strong>${visits.length}</strong> time${visits.length !== 1 ? 's' : ''}</p>`;
  html += '<div class="legs">';

  visits.forEach(v => {
    const dateStr = formatDate(v.arrivalDate);
    html += `
      <div class="leg-item city-visit">
        <div><strong>${v.trip.tripName}</strong></div>
        <div style="font-size:0.9em; opacity:0.9; margin-top:4px;">
          ${dateStr} • ${v.days} day${v.days !== 1 ? 's' : ''}
        </div>
      </div>
    `;
  });

  html += '</div>';
  document.getElementById("details-content").innerHTML = html;
}

// MOBILE: SIDE DRAWER
if (window.innerWidth <= 900) {
  document.documentElement.classList.add('mobile');

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("open-left").onclick = () => {
      document.documentElement.classList.toggle('sidebar-open-left');
      document.documentElement.classList.remove('sidebar-open-right');
    };

    document.getElementById("open-right").onclick = () => {
      document.documentElement.classList.toggle('sidebar-open-right');
      document.documentElement.classList.remove('sidebar-open-left');
    };
  });

  document.addEventListener('click', (e) => {
    if (e.target === document.documentElement) {
      document.documentElement.classList.remove('sidebar-open-left', 'sidebar-open-right');
    }
  });
}

// Phase 2: photo gallery — opens a new window with the OneDrive album viewer
function openPhotoPage(folderPath) {
  const url = `photos.html?folder=${encodeURIComponent(folderPath)}`;
  window.open(url, '_blank');
}