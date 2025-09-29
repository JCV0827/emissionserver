// Optional live carbon factor provider with safe fallbacks.
// Uses Electricity Maps if ELECTRICITYMAPS_API_KEY is provided.

const EM_API_KEY = process.env.ELECTRICITYMAPS_API_KEY;

// Minimal region to zone mapping (best-effort). For better coverage, pass `zone` explicitly from client/admin.
const regionToZone = {
  "United Kingdom": "GB",
  Germany: "DE",
  France: "FR",
  Spain: "ES",
  Portugal: "PT",
  Italy: "IT",
  Netherlands: "NL",
  Belgium: "BE",
  Switzerland: "CH",
  Austria: "AT",
  Denmark: "DK",
  Norway: "NO",
  Sweden: "SE",
  Finland: "FI",
  Ireland: "IE",
  Poland: "PL",
  "Czech Republic": "CZ",
  Slovakia: "SK",
  Hungary: "HU",
  Romania: "RO",
  Bulgaria: "BG",
  Greece: "GR",
  Slovenia: "SI",
  Croatia: "HR",
  Serbia: "RS",
  Bosnia: "BA",
  Montenegro: "ME",
  Albania: "AL",
  Moldova: "MD",
  Ukraine: "UA",
  Russia: "RU",
  "United States": "US-CAL" /* default to CA ISO as example */,
  Canada: "CA-ON",
  Mexico: "MX",
  Brazil: "BR",
  Argentina: "AR",
  Chile: "CL",
  Colombia: "CO",
  Peru: "PE",
  Australia: "AU",
  "New Zealand": "NZ",
  Singapore: "SG",
  Philippines: "PH",
  Japan: "JP",
  "South Korea": "KR",
  India: "IN-DEL" /* example zone */,
};

function mapRegionToZone(region) {
  if (!region) return undefined;
  return regionToZone[String(region).trim()] || undefined;
}

async function getLiveFactor({ region, zone, lat, lon } = {}) {
  if (!EM_API_KEY) return null; // Not configured

  try {
    let url;
    const headers = { 'auth-token': EM_API_KEY };

    if (typeof lat === 'number' && typeof lon === 'number') {
      url = `https://api.electricitymap.org/v3/carbon-intensity/latest?lat=${lat}&lon=${lon}`;
    } else {
      const resolvedZone = zone || mapRegionToZone(region);
      if (!resolvedZone) return null;
      url = `https://api.electricitymap.org/v3/carbon-intensity/latest?zone=${encodeURIComponent(resolvedZone)}`;
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const data = await resp.json();
    // Electricity Maps returns gCO2eq/kWh. Convert to kgCO2e/kWh
    const grams = data?.carbonIntensity;
    if (typeof grams !== 'number') return null;
    return grams / 1000;
  } catch (e) {
    // Silent fallback
    return null;
  }
}

module.exports = {
  getLiveFactor,
  mapRegionToZone,
};
