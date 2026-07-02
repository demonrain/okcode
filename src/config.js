export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const sessionSecret = String(env.SESSION_SECRET || '').trim();
  const adminPassword = String(env.ADMIN_PASSWORD || '').trim();
  const weakPasswords = new Set(['admin', 'password', 'change-me', 'changeme', '123456', 'admin123']);
  const placeholderPattern = /replace|change|development|example|placeholder|^your-/i;

  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD is required');
  }
  if (adminPassword.length < 12 || weakPasswords.has(adminPassword.toLowerCase()) || placeholderPattern.test(adminPassword)) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters and not a placeholder');
  }
  if (sessionSecret.length < 32 || placeholderPattern.test(sessionSecret)) {
    throw new Error('SESSION_SECRET must be at least 32 random characters');
  }

  return {
    port: Number(env.PORT || 3000),
    nodeEnv: env.NODE_ENV || 'development',
    databasePath: env.DATABASE_PATH || './data/app.sqlite',
    adminPassword,
    sessionSecret,
    secureCookies: env.SESSION_COOKIE_SECURE === 'true' || production,
    smsBowerApiKey: env.SMSBOWER_API_KEY || '',
    smsBowerBaseUrl: env.SMSBOWER_BASE_URL || 'https://smsbower.page/stubs/handler_api.php',
    serviceCode: env.SMSBOWER_SERVICE_CODE || '',
    country: env.SMSBOWER_COUNTRY || '0',
    countries: env.SMSBOWER_COUNTRIES || env.SMSBOWER_COUNTRY || '0',
    maxPrice: env.SMSBOWER_MAX_PRICE || '',
    minPrice: env.SMSBOWER_MIN_PRICE || '',
    qualityTier: env.SMSBOWER_QUALITY_TIER || 'any',
    activationTtlMinutes: Number(env.ACTIVATION_TTL_MINUTES || 25),
  };
}
