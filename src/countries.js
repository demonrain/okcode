const SMSBOWER_COUNTRIES = Object.freeze({
  0: { countryName: 'Russia', dialCode: '+7' },
  1: { countryName: 'Ukraine', dialCode: '+380' },
  2: { countryName: 'Kazakhstan', dialCode: '+7' },
  3: { countryName: 'China', dialCode: '+86' },
  4: { countryName: 'Philippines', dialCode: '+63' },
  5: { countryName: 'Myanmar', dialCode: '+95' },
  6: { countryName: 'Indonesia', dialCode: '+62' },
  7: { countryName: 'Malaysia', dialCode: '+60' },
  8: { countryName: 'Kenya', dialCode: '+254' },
  9: { countryName: 'Tanzania', dialCode: '+255' },
  10: { countryName: 'Vietnam', dialCode: '+84' },
  11: { countryName: 'Kyrgyzstan', dialCode: '+996' },
  12: { countryName: 'United States', dialCode: '+1' },
  13: { countryName: 'Israel', dialCode: '+972' },
  14: { countryName: 'Hong Kong', dialCode: '+852' },
  15: { countryName: 'Poland', dialCode: '+48' },
  16: { countryName: 'United Kingdom', dialCode: '+44' },
  21: { countryName: 'Egypt', dialCode: '+20' },
  22: { countryName: 'India', dialCode: '+91' },
  31: { countryName: 'South Africa', dialCode: '+27' },
  33: { countryName: 'Colombia', dialCode: '+57' },
  36: { countryName: 'Canada', dialCode: '+1' },
  37: { countryName: 'Morocco', dialCode: '+212' },
  38: { countryName: 'Ghana', dialCode: '+233' },
  39: { countryName: 'Argentina', dialCode: '+54' },
  40: { countryName: 'Uzbekistan', dialCode: '+998' },
  43: { countryName: 'Germany', dialCode: '+49' },
  46: { countryName: 'Sweden', dialCode: '+46' },
  48: { countryName: 'Netherlands', dialCode: '+31' },
  52: { countryName: 'Thailand', dialCode: '+66' },
  53: { countryName: 'Saudi Arabia', dialCode: '+966' },
  54: { countryName: 'Mexico', dialCode: '+52' },
  55: { countryName: 'Taiwan', dialCode: '+886' },
  56: { countryName: 'Spain', dialCode: '+34' },
  57: { countryName: 'Iran', dialCode: '+98' },
  58: { countryName: 'Algeria', dialCode: '+213' },
  60: { countryName: 'Bangladesh', dialCode: '+880' },
  62: { countryName: 'Turkey', dialCode: '+90' },
  63: { countryName: 'Czech Republic', dialCode: '+420' },
  64: { countryName: 'Sri Lanka', dialCode: '+94' },
  65: { countryName: 'Peru', dialCode: '+51' },
  66: { countryName: 'Pakistan', dialCode: '+92' },
  67: { countryName: 'New Zealand', dialCode: '+64' },
  70: { countryName: 'Venezuela', dialCode: '+58' },
  73: { countryName: 'Brazil', dialCode: '+55' },
  74: { countryName: 'Afghanistan', dialCode: '+93' },
  78: { countryName: 'France', dialCode: '+33' },
  82: { countryName: 'Belgium', dialCode: '+32' },
  83: { countryName: 'Bulgaria', dialCode: '+359' },
  84: { countryName: 'Hungary', dialCode: '+36' },
  85: { countryName: 'Moldova', dialCode: '+373' },
  86: { countryName: 'Italy', dialCode: '+39' },
  95: { countryName: 'United Arab Emirates', dialCode: '+971' },
  109: { countryName: 'Dominican Republic', dialCode: '+1' },
  117: { countryName: 'Portugal', dialCode: '+351' },
  128: { countryName: 'Georgia', dialCode: '+995' },
  129: { countryName: 'Greece', dialCode: '+30' },
  143: { countryName: 'Tajikistan', dialCode: '+992' },
  145: { countryName: 'Bahrain', dialCode: '+973' },
  148: { countryName: 'Armenia', dialCode: '+374' },
  151: { countryName: 'Chile', dialCode: '+56' },
  156: { countryName: 'Uruguay', dialCode: '+598' },
});

function normalizeCountryCode(countryCode) {
  const normalized = String(countryCode ?? '').trim();
  return normalized || null;
}

function normalizePhoneNumber(phoneNumber) {
  const normalized = String(phoneNumber ?? '').replace(/\D/g, '');
  return normalized || null;
}

function withoutDialCode(phoneNumber, dialCode) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone || !dialCode) return normalizedPhone;

  const dialDigits = dialCode.replace(/\D/g, '');
  if (!dialDigits || !normalizedPhone.startsWith(dialDigits)) return normalizedPhone;

  return normalizedPhone.slice(dialDigits.length) || normalizedPhone;
}

export function getPhoneCountryInfo(countryCode, phoneNumber) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const country = normalizedCountryCode ? SMSBOWER_COUNTRIES[normalizedCountryCode] : null;

  return {
    countryCode: normalizedCountryCode,
    countryName: country?.countryName ?? (normalizedCountryCode ? `Country ${normalizedCountryCode}` : null),
    dialCode: country?.dialCode ?? null,
    localNumber: withoutDialCode(phoneNumber, country?.dialCode),
  };
}
