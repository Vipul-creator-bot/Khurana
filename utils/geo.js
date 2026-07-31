// Store's serviceable location and delivery radius. Update STORE_LAT/STORE_LNG
// in backend/.env to your actual store's coordinates (e.g. from Google Maps:
// right-click the exact spot → the lat,lng shown first in the popup).
const STORE_LOCATION = {
  lat: Number(process.env.STORE_LAT) || 28.5017, // Placeholder: Udyog Vihar, Sector 18, Gurugram
  lng: Number(process.env.STORE_LNG) || 77.0870,
};

// Gurugram (Gurgaon) district spans roughly 30km end-to-end, so the radius
// is set wide enough to cover the whole city rather than just the
// immediate neighbourhood — the service area is "Gurgaon", not a tight
// delivery-partner radius. Override via DELIVERY_RADIUS_KM in .env.
const DELIVERY_RADIUS_KM = Number(process.env.DELIVERY_RADIUS_KM) || 30;

// Extra safety net alongside the GPS radius check: since a GPS radius from
// one point doesn't perfectly match a city's administrative boundary (a
// point could be within the radius but technically in a neighbouring town,
// or vice versa), we also require the shopper's typed address to actually
// mention Gurgaon/Gurugram. Both checks must pass.
const SERVICE_CITY_KEYWORDS = ['gurgaon', 'gurugram'];

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

// Haversine formula — great-circle distance between two lat/lng points, in km.
function distanceInKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function checkDeliveryAvailability(lat, lng) {
  const distanceKm = distanceInKm(STORE_LOCATION.lat, STORE_LOCATION.lng, lat, lng);
  return {
    withinRange: distanceKm <= DELIVERY_RADIUS_KM,
    distanceKm: Math.round(distanceKm * 10) / 10,
    maxRadiusKm: DELIVERY_RADIUS_KM,
  };
}

// Case-insensitive check that the address text mentions the serviceable city.
function isAddressInServiceCity(address) {
  if (!address || typeof address !== 'string') return false;
  const normalized = address.toLowerCase();
  return SERVICE_CITY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

module.exports = {
  STORE_LOCATION,
  DELIVERY_RADIUS_KM,
  SERVICE_CITY_KEYWORDS,
  distanceInKm,
  checkDeliveryAvailability,
  isAddressInServiceCity,
};
