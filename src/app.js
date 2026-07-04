import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositories } from './db.js';
import { SmsbowerError } from './smsbower.js';
import { SqliteSessionStore } from './session-store.js';
import { renderAdminPage, renderLoginPage, renderRedeemPage } from './views.js';
import { getPhoneCountryInfo } from './countries.js';
import { formatDateTime } from './format.js';
import { defaultPurchaseSettingsFromConfig, normalizePurchaseSettings } from './purchase-settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const PURCHASE_SETTINGS_KEY = 'purchase_settings';

class AppError extends Error {
  constructor(status, message, code = 'APP_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function safeCompare(actual, expected) {
  const actualBuffer = Buffer.from(String(actual ?? ''));
  const expectedBuffer = Buffer.from(String(expected ?? ''));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
  );
  next();
}

function blockSensitivePaths(req, res, next) {
  const requestPath = decodeURIComponent(req.path || '').replace(/\\/g, '/');
  const lowerPath = requestPath.toLowerCase();
  const blocked =
    /(^|\/)\.env([./-]|$)/.test(lowerPath) ||
    /(^|\/)[^/]*\.env($|[./-])/.test(lowerPath) ||
    /(^|\/)(\.git|data|node_modules)(\/|$)/.test(lowerPath) ||
    /\.(sqlite|sqlite3|db|log)$/i.test(lowerPath);

  if (blocked) {
    return res.status(404).type('txt').send('Not Found');
  }
  return next();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function secondsUntil(expiresAt, now) {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000));
}

function serializeKey(key, currentTime = new Date()) {
  const countryInfo = getPhoneCountryInfo(key.activation?.countryCode, key.activation?.phoneNumber);
  return {
    id: key.id,
    keyPrefix: key.keyPrefix,
    status: key.status,
    createdAt: formatDateTime(key.createdAt),
    redeemedAt: formatDateTime(key.redeemedAt),
    expiresAt: formatDateTime(key.expiresAt),
    usedAt: formatDateTime(key.usedAt),
    revokedAt: formatDateTime(key.revokedAt),
    phoneNumber: key.activation?.phoneNumber ?? null,
    countryCode: countryInfo.countryCode,
    countryName: countryInfo.countryName,
    dialCode: countryInfo.dialCode,
    localNumber: countryInfo.localNumber,
    activationId: key.activation?.activationId ?? null,
    activationCost: key.activation?.activationCost ?? null,
    code: key.activation?.code ?? null,
    hasCode: Boolean(key.activation?.code),
    expiresInSeconds: key.expiresAt ? secondsUntil(key.expiresAt, currentTime) : null,
  };
}

function serializeRedeem(key, currentTime) {
  const countryInfo = getPhoneCountryInfo(key.activation?.countryCode, key.activation?.phoneNumber);
  return {
    status: key.status,
    phoneNumber: key.activation?.phoneNumber ?? null,
    countryCode: countryInfo.countryCode,
    countryName: countryInfo.countryName,
    dialCode: countryInfo.dialCode,
    localNumber: countryInfo.localNumber,
    code: key.activation?.code ?? null,
    expiresAt: formatDateTime(key.expiresAt),
    expiresInSeconds: key.expiresAt ? secondsUntil(key.expiresAt, currentTime) : null,
  };
}

function isExpired(key, currentTime) {
  return key.status === 'active' && key.expiresAt && new Date(key.expiresAt).getTime() <= currentTime.getTime();
}

async function bestEffortCancel(smsClient, activationId) {
  if (!activationId) return;
  try {
    await smsClient.setStatus(activationId, 8);
  } catch (error) {
    if (error instanceof SmsbowerError && error.code === 'EARLY_CANCEL_DENIED') return;
    console.warn('Failed to cancel SMSBower activation:', error.message);
  }
}

function getStoredPurchaseSettings(repo, config) {
  const fallback = defaultPurchaseSettingsFromConfig(config);
  return normalizePurchaseSettings(repo.getSetting(PURCHASE_SETTINGS_KEY) ?? fallback, fallback);
}

function saveStoredPurchaseSettings(repo, config, input) {
  const fallback = getStoredPurchaseSettings(repo, config);
  const settings = normalizePurchaseSettings(input, fallback);
  return repo.saveSetting(PURCHASE_SETTINGS_KEY, settings);
}

function providerIdsForCountry(topCountries, countryCode) {
  const countryProviders = topCountries?.[countryCode] ?? topCountries?.[Number(countryCode)];
  if (!countryProviders || typeof countryProviders !== 'object') return '';
  return Object.entries(countryProviders)
    .sort(([, left], [, right]) => Number(right?.count ?? 0) - Number(left?.count ?? 0))
    .map(([providerId]) => providerId)
    .join(',');
}

function isRetryablePurchaseError(error) {
  return error instanceof SmsbowerError && ['NO_NUMBERS', 'BAD_COUNTRY'].includes(error.code);
}

async function purchaseNumber(smsClient, settings) {
  const topCountries =
    settings.qualityTier === 'gold' ? await smsClient.getTopCountriesByService(settings.serviceCode) : null;
  let lastError = null;

  for (const country of settings.countries) {
    const options = {
      serviceCode: settings.serviceCode,
      country: country.countryCode,
      minPrice: settings.minPrice,
      maxPrice: settings.maxPrice,
      providerIds: settings.qualityTier === 'gold' ? providerIdsForCountry(topCountries, country.countryCode) : '',
    };

    try {
      return await smsClient.getNumber(options);
    } catch (error) {
      lastError = error;
      if (!isRetryablePurchaseError(error)) throw error;
    }
  }

  throw lastError ?? new SmsbowerError('NO_NUMBERS', 'NO_NUMBERS');
}

function requireAdmin(req, res, next) {
  if (req.session?.admin === true) return next();
  return res.status(401).json({ error: '需要管理员登录' });
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const provided = req.get('X-CSRF-Token') || req.body?._csrf;
  if (!expected || !provided || !safeCompare(provided, expected)) {
    return res.status(403).json({ error: 'CSRF token invalid', code: 'CSRF_INVALID' });
  }
  return next();
}

export function createApp({ db, smsClient, config, now = () => new Date() }) {
  const app = express();
  const repo = createRepositories(db, now, { cdKeyEncryptionSecret: config.cdKeyEncryptionSecret || config.sessionSecret });

  app.disable('x-powered-by');
  app.set('trust proxy', config.secureCookies ? 1 : false);
  app.use(securityHeaders);
  app.use(blockSensitivePaths);
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.static(publicDir, { dotfiles: 'deny' }));
  app.use(
    session({
      name: 'ok_cdkey.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new SqliteSessionStore(db),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: Boolean(config.secureCookies),
        maxAge: 12 * 60 * 60 * 1000,
      },
    }),
  );

  app.get('/', (req, res) => res.type('html').send(renderRedeemPage()));

  app.post(
    '/api/redeem',
    asyncRoute(async (req, res) => {
      const keyText = repo.normalizeKey(req.body.key);
      if (!keyText) throw new AppError(400, '请输入 CDKey', 'KEY_REQUIRED');

      let key = repo.findKeyByPlaintext(keyText);
      if (!key) throw new AppError(404, 'CDKey 不存在', 'KEY_NOT_FOUND');

      const currentTime = now();
      if (key.status === 'revoked') throw new AppError(410, 'CDKey 已撤销', 'KEY_REVOKED');
      if (key.status === 'expired') throw new AppError(410, 'CDKey 已过期', 'KEY_EXPIRED');
      if (isExpired(key, currentTime)) {
        key = repo.markExpired(key.id);
        await bestEffortCancel(smsClient, key.activation?.activationId);
        throw new AppError(410, 'CDKey 已过期', 'KEY_EXPIRED');
      }

      if (key.status === 'unused') {
        const number = await purchaseNumber(smsClient, getStoredPurchaseSettings(repo, config));
        key = repo.storeActivation(key.id, number, addMinutes(currentTime, config.activationTtlMinutes));
      }

      return res.json(serializeRedeem(key, now()));
    }),
  );

  app.get(
    '/api/redeem/:key/status',
    asyncRoute(async (req, res) => {
      const keyText = repo.normalizeKey(req.params.key);
      let key = repo.findKeyByPlaintext(keyText);
      if (!key) throw new AppError(404, 'CDKey 不存在', 'KEY_NOT_FOUND');

      const currentTime = now();
      if (key.status === 'unused') throw new AppError(400, 'CDKey 尚未领取手机号', 'KEY_UNUSED');
      if (key.status === 'revoked') throw new AppError(410, 'CDKey 已撤销', 'KEY_REVOKED');
      if (key.status === 'expired') throw new AppError(410, 'CDKey 已过期', 'KEY_EXPIRED');
      if (isExpired(key, currentTime)) {
        key = repo.markExpired(key.id);
        await bestEffortCancel(smsClient, key.activation?.activationId);
        return res.status(410).json(serializeRedeem(key, now()));
      }

      if (key.status === 'active') {
        const smsStatus = await smsClient.getStatus(key.activation.activationId);
        if (smsStatus.state === 'ok') {
          key = repo.markUsed(key.id, smsStatus.code, smsStatus.raw);
          try {
            await smsClient.setStatus(key.activation.activationId, 6);
          } catch (error) {
            console.warn('Failed to complete SMSBower activation:', error.message);
          }
        } else if (smsStatus.state === 'canceled') {
          key = repo.markExpired(key.id);
          return res.status(410).json(serializeRedeem(key, now()));
        } else {
          key = repo.updateActivationStatus(key.id, smsStatus.state, smsStatus.raw);
        }
      }

      return res.json(serializeRedeem(key, now()));
    }),
  );

  app.post(
    '/api/redeem/:key/replace',
    asyncRoute(async (req, res) => {
      const keyText = repo.normalizeKey(req.params.key);
      let key = repo.findKeyByPlaintext(keyText);
      if (!key) throw new AppError(404, 'CDKey 不存在', 'KEY_NOT_FOUND');

      const currentTime = now();
      if (key.status === 'unused') throw new AppError(400, 'CDKey 尚未领取手机号', 'KEY_UNUSED');
      if (key.status === 'used') throw new AppError(409, 'CDKey 已收到验证码，不能更换号码', 'KEY_ALREADY_USED');
      if (key.status === 'revoked') throw new AppError(410, 'CDKey 已撤销', 'KEY_REVOKED');
      if (key.status === 'expired') throw new AppError(410, 'CDKey 已过期', 'KEY_EXPIRED');
      if (isExpired(key, currentTime)) {
        key = repo.markExpired(key.id);
        await bestEffortCancel(smsClient, key.activation?.activationId);
        return res.status(410).json(serializeRedeem(key, now()));
      }
      if (key.status !== 'active' || !key.activation?.activationId) {
        throw new AppError(409, '当前 CDKey 状态不可更换号码', 'KEY_NOT_REPLACEABLE');
      }

      const oldActivationId = key.activation.activationId;
      const smsStatus = await smsClient.getStatus(oldActivationId);

      if (smsStatus.state === 'ok') {
        key = repo.markUsed(key.id, smsStatus.code, smsStatus.raw);
        try {
          await smsClient.setStatus(oldActivationId, 6);
        } catch (error) {
          console.warn('Failed to complete SMSBower activation:', error.message);
        }
        throw new AppError(409, '当前号码已收到验证码，不能更换号码', 'KEY_ALREADY_USED');
      }
      if (smsStatus.state === 'canceled') {
        key = repo.markExpired(key.id);
        return res.status(410).json(serializeRedeem(key, now()));
      }
      if (!['waiting', 'retry'].includes(smsStatus.state)) {
        throw new AppError(409, '当前号码状态不可更换', 'KEY_NOT_REPLACEABLE');
      }

      try {
        await smsClient.setStatus(oldActivationId, 8);
      } catch (error) {
        if (error instanceof SmsbowerError && error.code === 'EARLY_CANCEL_DENIED') {
          throw new AppError(409, '号码购买后至少 2 分钟才能取消，请稍后再试', 'REPLACE_TOO_EARLY');
        }
        throw error;
      }

      const number = await purchaseNumber(smsClient, getStoredPurchaseSettings(repo, config));
      key = repo.replaceActivation(key.id, number, addMinutes(now(), config.activationTtlMinutes));
      return res.json(serializeRedeem(key, now()));
    }),
  );

  app.get('/admin/login', (req, res) => res.type('html').send(renderLoginPage()));
  app.post('/admin/login', (req, res, next) => {
    if (!safeCompare(req.body.password, config.adminPassword)) {
      return res.status(401).type('html').send(renderLoginPage('密码错误'));
    }

    return req.session.regenerate((regenerateError) => {
      if (regenerateError) return next(regenerateError);
      req.session.admin = true;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res.redirect('/admin');
      });
    });
  });

  app.post('/admin/logout', requireAdmin, requireCsrf, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      return res.redirect('/admin/login');
    });
  });

  app.get('/admin', (req, res) => {
    if (req.session?.admin !== true) return res.redirect('/admin/login');
    return res.type('html').send(renderAdminPage(ensureCsrfToken(req)));
  });

  app.get(
    '/admin/api/health',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const purchaseSettings = getStoredPurchaseSettings(repo, config);
      const missing = [];
      if (!smsClient.apiKey) missing.push('SMSBOWER_API_KEY');
      if (!purchaseSettings.serviceCode) missing.push('SMSBOWER_SERVICE_CODE');
      let balance = null;
      if (missing.length === 0) {
        balance = await smsClient.getBalance();
      }
      res.json({
        ok: missing.length === 0,
        missing,
        balance: balance?.balance ?? null,
        serviceCode: purchaseSettings.serviceCode || null,
        countries: purchaseSettings.countries,
        qualityTier: purchaseSettings.qualityTier,
        maxPrice: purchaseSettings.maxPrice || null,
        minPrice: purchaseSettings.minPrice || null,
        qualityApiSupport: {
          gold: 'Uses getTopCountriesByService providerIds when available',
          silver: 'No direct SMSBower API parameter documented',
          bronze: 'No direct SMSBower API parameter documented',
        },
        ttlMinutes: config.activationTtlMinutes,
      });
    }),
  );

  app.get('/admin/api/settings', requireAdmin, (req, res) => {
    res.json(getStoredPurchaseSettings(repo, config));
  });

  app.post('/admin/api/settings', requireAdmin, requireCsrf, (req, res) => {
    try {
      res.json(saveStoredPurchaseSettings(repo, config, req.body));
    } catch (error) {
      throw new AppError(400, error.message, 'INVALID_SETTINGS');
    }
  });

  app.get('/admin/api/keys', requireAdmin, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const currentTime = now();
    const keyText = repo.normalizeKey(req.query.key);
    const result = keyText ? repo.listKeysByPlaintext(keyText) : repo.listKeys({ limit, offset });
    res.json({ total: result.total, keys: result.keys.map((key) => serializeKey(key, currentTime)) });
  });

  app.post('/admin/api/keys', requireAdmin, requireCsrf, (req, res) => {
    const count = Number(req.body.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new AppError(400, '生成数量必须是 1 到 500 的整数', 'INVALID_COUNT');
    }
    res.status(201).json({ keys: repo.createKeys(count) });
  });

  app.post('/admin/api/keys/validate', requireAdmin, requireCsrf, (req, res) => {
    const key = repo.findKeyByPlaintext(req.body.key);
    if (!key) throw new AppError(404, 'CDKey 不存在', 'KEY_NOT_FOUND');
    res.json(serializeKey(key, now()));
  });

  app.post(
    '/admin/api/keys/:id/revoke',
    requireAdmin,
    requireCsrf,
    asyncRoute(async (req, res) => {
      const result = repo.revokeKey(Number(req.params.id));
      if (!result) throw new AppError(404, 'CDKey 不存在', 'KEY_NOT_FOUND');
      if (!result.changed) throw new AppError(409, '当前状态不可撤销', 'KEY_NOT_REVOCABLE');
      if (result.previous.activation?.activationId) {
        await bestEffortCancel(smsClient, result.previous.activation.activationId);
      }
      res.json(serializeKey(result.key, now()));
    }),
  );

  app.use((req, res) => {
    res.status(404).format({
      html: () => res.send('<h1>404</h1>'),
      json: () => res.json({ error: 'Not Found' }),
      default: () => res.type('txt').send('Not Found'),
    });
  });

  app.use((err, req, res, next) => {
    const status = err.status || (err instanceof SmsbowerError ? 502 : 500);
    const expose = err instanceof AppError || err instanceof SmsbowerError;
    const body = {
      error: expose ? err.message || 'Internal Server Error' : 'Internal Server Error',
      code: expose ? err.code || 'APP_ERROR' : 'INTERNAL_ERROR',
    };
    res.status(status).json(body);
  });

  return app;
}
