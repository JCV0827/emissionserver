// Emission factors by country/region in kg CO2e per kWh (approximate/grid average)
// Notes:
// - Values are indicative and can vary by year and methodology.
// - For regions without a specific entry, a conservative global average is used.

const DEFAULT_FACTOR = 0.475; // global average fallback (kg CO2e/kWh)

// Known factors (add/update as needed)
const knownFactors = {
  // Asia
  Singapore: 0.412,
  Philippines: 0.5246,
  China: 0.65,
  India: 0.708,
  Japan: 0.465,
  "South Korea": 0.54,
  Indonesia: 0.789,
  Malaysia: 0.625,
  Thailand: 0.563,
  Vietnam: 0.599,
  Bangladesh: 0.703,
  Pakistan: 0.479,
  "Sri Lanka": 0.541,
  Nepal: 0.028,
  UAE: 0.542,
  Qatar: 0.617,
  Oman: 0.63,
  "Saudi Arabia": 0.76,
  Israel: 0.52,
  Turkey: 0.44,
  Kazakhstan: 0.66,
  Uzbekistan: 0.62,
  Azerbaijan: 0.52,
  Armenia: 0.19,
  Georgia: 0.12,

  // Europe
  "United Kingdom": 0.193,
  Germany: 0.311,
  France: 0.053,
  Spain: 0.182,
  Italy: 0.236,
  Portugal: 0.124,
  Netherlands: 0.403,
  Belgium: 0.201,
  Switzerland: 0.026,
  Austria: 0.166,
  Denmark: 0.084,
  Norway: 0.018,
  Sweden: 0.028,
  Finland: 0.083,
  Ireland: 0.297,
  Poland: 0.724,
  "Czech Republic": 0.495,
  Slovakia: 0.29,
  Hungary: 0.221,
  Romania: 0.297,
  Bulgaria: 0.447,
  Greece: 0.443,
  "North Macedonia": 0.61,
  Slovenia: 0.25,
  Croatia: 0.19,
  Serbia: 0.58,
  Bosnia: 0.72,
  Montenegro: 0.37,
  Albania: 0.057,
  Moldova: 0.42,
  Ukraine: 0.353,
  Russia: 0.439,

  // Americas
  "United States": 0.386,
  Canada: 0.12,
  Mexico: 0.412,
  Brazil: 0.095,
  Argentina: 0.357,
  Chile: 0.375,
  Colombia: 0.112,
  Peru: 0.124,
  Uruguay: 0.061,
  Paraguay: 0.024,
  Bolivia: 0.41,
  Ecuador: 0.25,
  Venezuela: 0.46,
  "Dominican Republic": 0.59,
  Jamaica: 0.73,
  Haiti: 0.44,
  Guatemala: 0.28,
  Honduras: 0.37,
  Nicaragua: 0.23,
  "El Salvador": 0.29,
  Panama: 0.22,
  Cuba: 0.78,
  "Trinidad and Tobago": 0.83,

  // Africa
  Nigeria: 0.547,
  Egypt: 0.538,
  SouthAfrica: 0.9,
  "South Africa": 0.9,
  Morocco: 0.604,
  Algeria: 0.58,
  Tunisia: 0.482,
  Kenya: 0.079,
  Ethiopia: 0.034,
  Ghana: 0.399,
  Angola: 0.37,
  Tanzania: 0.28,
  Uganda: 0.09,
  Rwanda: 0.08,
  Senegal: 0.57,
  Cote_dIvoire: 0.43,
  "Côte d’Ivoire": 0.43,
  Cameroon: 0.29,
  Mozambique: 0.15,
  Zambia: 0.08,
  Zimbabwe: 0.83,
  Namibia: 0.58,
  Botswana: 0.83,
  "DR Congo": 0.02,

  // Oceania
  Australia: 0.681,
  "New Zealand": 0.095,
  Fiji: 0.38,

  // Middle East/North Africa (additional)
  Iran: 0.64,
  Iraq: 0.71,
  Jordan: 0.62,
  Lebanon: 0.64,
  Kuwait: 0.64,
  Bahrain: 0.73,
};

// Broad list of countries/regions for UI selection
const additionalRegions = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Armenia",
  "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin",
  "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
  "Cabo Verde", "Cambodia", "Cameroon", "Central African Republic", "Chad", "Chile", "China", "Comoros",
  "Congo", "DR Congo", "Costa Rica", "Côte d’Ivoire", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea",
  "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia",
  "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti",
  "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "North Korea", "South Korea", "Kosovo",
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
  "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands",
  "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
  "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger",
  "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Panama", "Papua New Guinea",
  "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda",
  "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
  "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
  "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Sudan", "Spain", "Sri Lanka",
  "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand",
  "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

function normalizeName(name) {
  return String(name || "").trim();
}

function getFactor(region) {
  const key = normalizeName(region);
  if (!key) return DEFAULT_FACTOR;
  if (knownFactors.hasOwnProperty(key)) return knownFactors[key];
  // Try alternative spellings for a few known cases
  if (key.toLowerCase() === "ivory coast") return knownFactors["Côte d’Ivoire"] || DEFAULT_FACTOR;
  if (key.toLowerCase() === "cote d'ivoire") return knownFactors["Côte d’Ivoire"] || DEFAULT_FACTOR;
  if (key.toLowerCase() === "southafrica") return knownFactors["South Africa"] || DEFAULT_FACTOR;
  return DEFAULT_FACTOR;
}

function getRegions() {
  const set = new Set([...Object.keys(knownFactors), ...additionalRegions]);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

module.exports = {
  DEFAULT_FACTOR,
  getFactor,
  getRegions,
};
