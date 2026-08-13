function visitedBadgeHtml(dateStr) {
  return `<div class="visited-date mb-1"><i class="fa-solid fa-circle-check text-success"></i> Visited ${new Date(dateStr).toLocaleDateString()}</div>`;
}

async function loadMyPlaces() {
  const user = currentUser();
  if (!user) {
    document.getElementById('loggedOutNotice').classList.remove('d-none');
    document.getElementById('myPlacesContent').classList.add('d-none');
    return;
  }
  document.getElementById('loggedOutNotice').classList.add('d-none');
  document.getElementById('myPlacesContent').classList.remove('d-none');

  const [favRes, visRes, placesRes] = await Promise.all([
    fetch('/favorites', { headers: authHeaders() }),
    fetch('/visited', { headers: authHeaders() }),
    fetch('/services')
  ]);
  const favorites = favRes.ok ? (await favRes.json()).favorites : [];
  const visited = visRes.ok ? (await visRes.json()).visited : [];
  const places = placesRes.ok ? await placesRes.json() : [];
  const byId = Object.fromEntries(places.map(p => [p.id, p]));
  myFavoritesCache = favorites; // so renderServiceCard shows the correct heart state here too

  const savedList = document.getElementById('savedList');
  const savedPlaces = favorites.map(id => byId[id]).filter(Boolean);
  savedList.innerHTML = savedPlaces.map(renderServiceCard).join('');
  document.getElementById('savedEmpty').classList.toggle('d-none', savedPlaces.length > 0);

  const visitedList = document.getElementById('visitedList');
  const visitedEntries = visited
    .slice()
    .sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt))
    .map(v => ({ place: byId[v.placeId], visitedAt: v.visitedAt }))
    .filter(v => v.place);
  visitedList.innerHTML = visitedEntries
    .map(v => `<div>${visitedBadgeHtml(v.visitedAt)}${renderServiceCard(v.place)}</div>`)
    .join('');
  document.getElementById('visitedEmpty').classList.toggle('d-none', visitedEntries.length > 0);
}

document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  startLiveLocation();
  loadMyPlaces();
});
