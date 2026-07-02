export class SmsbowerError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'SmsbowerError';
    this.code = code;
    this.details = details;
  }
}

function maybeParseJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function throwIfPlatformError(value) {
  if (typeof value !== 'string') return;
  const code = value.split(':', 1)[0].trim();
  if (/^(BAD|NO|WRONG|EARLY|BANNED|ERROR)_/.test(code) || code === 'NO_BALANCE' || code === 'NO_NUMBERS') {
    throw new SmsbowerError(code, value);
  }
}

function normalizeObjectError(value) {
  if (!value || typeof value !== 'object') return;
  if (value.status === 'error' || value.error) {
    const code = String(value.code || value.error || value.message || 'SMSBOWER_ERROR');
    throw new SmsbowerError(code, String(value.message || code), { raw: value });
  }
}

export function parseNumberResponse(response) {
  const parsed = maybeParseJson(response);
  normalizeObjectError(parsed);

  if (parsed && typeof parsed === 'object') {
    if (parsed.activationId == null || parsed.phoneNumber == null) {
      throw new SmsbowerError('UNEXPECTED_RESPONSE', 'SMSBower number response is missing activationId or phoneNumber', {
        raw: parsed,
      });
    }

    return {
      activationId: String(parsed.activationId),
      phoneNumber: String(parsed.phoneNumber),
      activationCost: parsed.activationCost == null ? null : String(parsed.activationCost),
      countryCode: parsed.countryCode == null ? null : String(parsed.countryCode),
      activationTime: parsed.activationTime == null ? null : String(parsed.activationTime),
      canGetAnotherSms: parsed.canGetAnotherSms ?? null,
      raw: parsed,
    };
  }

  throwIfPlatformError(parsed);

  const match = /^ACCESS_NUMBER:([^:]+):(.+)$/.exec(String(parsed));
  if (!match) {
    throw new SmsbowerError('UNEXPECTED_RESPONSE', `Unexpected SMSBower number response: ${String(parsed)}`, {
      raw: parsed,
    });
  }

  return {
    activationId: match[1],
    phoneNumber: match[2],
    activationCost: null,
    countryCode: null,
    activationTime: null,
    canGetAnotherSms: null,
    raw: parsed,
  };
}

export function parseStatusResponse(response) {
  const parsed = maybeParseJson(response);
  if (parsed && typeof parsed === 'object') {
    normalizeObjectError(parsed);
    if (parsed.code) {
      return {
        state: 'ok',
        code: String(parsed.code),
        lastCode: null,
        raw: parsed,
      };
    }
  }

  const value = String(parsed).trim();
  throwIfPlatformError(value);

  if (value === 'STATUS_WAIT_CODE') {
    return { state: 'waiting', code: null, lastCode: null, raw: value };
  }

  if (value.startsWith('STATUS_WAIT_RETRY:')) {
    return { state: 'retry', code: null, lastCode: value.slice('STATUS_WAIT_RETRY:'.length), raw: value };
  }

  if (value === 'STATUS_CANCEL') {
    return { state: 'canceled', code: null, lastCode: null, raw: value };
  }

  if (value.startsWith('STATUS_OK:')) {
    return { state: 'ok', code: value.slice('STATUS_OK:'.length).trim(), lastCode: null, raw: value };
  }

  throw new SmsbowerError('UNEXPECTED_RESPONSE', `Unexpected SMSBower status response: ${value}`, { raw: parsed });
}

export function parseBalanceResponse(response) {
  const parsed = maybeParseJson(response);
  normalizeObjectError(parsed);
  throwIfPlatformError(parsed);

  const match = /^ACCESS_BALANCE:(.+)$/.exec(String(parsed).trim());
  if (!match) {
    throw new SmsbowerError('UNEXPECTED_RESPONSE', `Unexpected SMSBower balance response: ${String(parsed)}`, {
      raw: parsed,
    });
  }

  return { balance: match[1], raw: parsed };
}

export function parseSetStatusResponse(response) {
  const parsed = maybeParseJson(response);
  normalizeObjectError(parsed);
  const value = String(parsed).trim();
  throwIfPlatformError(value);

  if (/^ACCESS_(READY|RETRY_GET|ACTIVATION|CANCEL)$/.test(value)) {
    return { ok: true, raw: value };
  }

  throw new SmsbowerError('UNEXPECTED_RESPONSE', `Unexpected SMSBower setStatus response: ${value}`, { raw: parsed });
}

export function parseTopCountriesResponse(response) {
  const parsed = maybeParseJson(response);
  normalizeObjectError(parsed);
  throwIfPlatformError(parsed);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SmsbowerError('UNEXPECTED_RESPONSE', 'Unexpected SMSBower top countries response', { raw: parsed });
  }

  return parsed;
}

export class SmsbowerClient {
  constructor({
    apiKey,
    baseUrl = 'https://smsbower.page/stubs/handler_api.php',
    serviceCode,
    country = '0',
    maxPrice = '',
    minPrice = '',
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.serviceCode = serviceCode;
    this.country = country;
    this.maxPrice = maxPrice;
    this.minPrice = minPrice;
    this.fetchImpl = fetchImpl;
  }

  ensureConfigured(requireService = false) {
    if (!this.apiKey) throw new SmsbowerError('MISSING_API_KEY', 'SMSBOWER_API_KEY is not configured');
    if (requireService && !this.serviceCode) {
      throw new SmsbowerError('MISSING_SERVICE_CODE', 'SMSBOWER_SERVICE_CODE is not configured');
    }
  }

  async request(action, params = {}) {
    this.ensureConfigured(false);

    const url = new URL(this.baseUrl);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('action', action);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url);
    const body = await response.text();
    if (!response.ok) {
      throw new SmsbowerError('HTTP_ERROR', `SMSBower returned HTTP ${response.status}`, { status: response.status, body });
    }
    return maybeParseJson(body);
  }

  async getBalance() {
    const response = await this.request('getBalance');
    return parseBalanceResponse(response);
  }

  async getNumber(options = {}) {
    const serviceCode = options.serviceCode ?? this.serviceCode;
    if (!serviceCode) {
      throw new SmsbowerError('MISSING_SERVICE_CODE', 'SMSBOWER_SERVICE_CODE is not configured');
    }
    const response = await this.request('getNumberV2', {
      service: serviceCode,
      country: options.country ?? this.country,
      maxPrice: options.maxPrice ?? this.maxPrice,
      minPrice: options.minPrice ?? this.minPrice,
      providerIds: options.providerIds,
      exceptProviderIds: options.exceptProviderIds,
    });
    return parseNumberResponse(response);
  }

  async getTopCountriesByService(serviceCode = this.serviceCode) {
    if (!serviceCode) {
      throw new SmsbowerError('MISSING_SERVICE_CODE', 'SMSBOWER_SERVICE_CODE is not configured');
    }
    const response = await this.request('getTopCountriesByService', { service: serviceCode });
    return parseTopCountriesResponse(response);
  }

  async getStatus(activationId) {
    const response = await this.request('getStatus', { id: activationId });
    return parseStatusResponse(response);
  }

  async setStatus(activationId, status) {
    const response = await this.request('setStatus', { id: activationId, status });
    return parseSetStatusResponse(response);
  }
}
