const QUALITY_TIERS = new Set(['any', 'bronze', 'silver', 'gold']);

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizePrice(value, fieldName) {
  const price = normalizeString(value);
  if (!price) return '';
  if (!/^\d+(\.\d{1,6})?$/.test(price)) {
    throw new Error(`${fieldName} must be an empty value or a positive decimal number`);
  }
  return price;
}

function normalizeQualityTier(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return 'any';
  if (normalized === 'copper') return 'bronze';
  if (!QUALITY_TIERS.has(normalized)) {
    throw new Error('qualityTier must be any, bronze, silver, or gold');
  }
  return normalized;
}

function countryItemsFromInput(value) {
  if (Array.isArray(value)) return value;
  return normalizeString(value)
    .split(/[\n,]+/)
    .map((countryCode, index) => ({ countryCode, priority: index + 1 }));
}

export function normalizeCountries(value) {
  const countries = [];
  const seen = new Set();

  for (const item of countryItemsFromInput(value)) {
    const countryCode = normalizeString(typeof item === 'string' ? item : item?.countryCode);
    if (!countryCode || seen.has(countryCode)) continue;
    const priorityValue = Number(typeof item === 'string' ? countries.length + 1 : item?.priority);
    const priority = Number.isInteger(priorityValue) && priorityValue > 0 ? priorityValue : countries.length + 1;
    countries.push({ countryCode, priority });
    seen.add(countryCode);
  }

  return countries
    .sort((a, b) => a.priority - b.priority)
    .map((country, index) => ({ countryCode: country.countryCode, priority: index + 1 }));
}

export function normalizePurchaseSettings(input = {}, fallback = {}) {
  const fallbackCountries = fallback.countries?.length ? fallback.countries : normalizeCountries(fallback.country || '0');
  const countries = normalizeCountries(input.countries ?? input.country ?? fallbackCountries);
  if (countries.length === 0) {
    throw new Error('At least one country is required');
  }

  const minPrice = normalizePrice(input.minPrice ?? fallback.minPrice ?? '', 'minPrice');
  const maxPrice = normalizePrice(input.maxPrice ?? fallback.maxPrice ?? '', 'maxPrice');
  if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
    throw new Error('minPrice cannot be greater than maxPrice');
  }

  return {
    serviceCode: normalizeString(input.serviceCode ?? fallback.serviceCode),
    minPrice,
    maxPrice,
    qualityTier: normalizeQualityTier(input.qualityTier ?? fallback.qualityTier),
    countries,
  };
}

export function defaultPurchaseSettingsFromConfig(config) {
  return normalizePurchaseSettings({
    serviceCode: config.serviceCode,
    minPrice: config.minPrice,
    maxPrice: config.maxPrice,
    qualityTier: config.qualityTier,
    countries: config.countries ?? config.country,
  });
}
