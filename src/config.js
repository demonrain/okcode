export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const sessionSecret = env.SESSION_SECRET || (production ? '' : 'development-session-secret-change-before-production');
  const adminPassword = env.ADMIN_PASSWORD || (production ? '' : 'admin');

  if (production && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 bytes in production');
  }
  if (production && !adminPassword) {
    throw new Error('ADMIN_PASSWORD is required in production');
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
    maxPrice: env.SMSBOWER_MAX_PRICE || '',
    minPrice: env.SMSBOWER_MIN_PRICE || '',
    activationTtlMinutes: Number(env.ACTIVATION_TTL_MINUTES || 25),
  };
}
