import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { SmsbowerError } from '../src/smsbower.js';

function makeTestApp(overrides = {}) {
  const db = createDatabase(':memory:');
  const smsClient = {
    getBalance: vi.fn(async () => ({ balance: '10.00', raw: 'ACCESS_BALANCE:10.00' })),
    getNumber: vi.fn(async () => ({
      activationId: 'act-1',
      phoneNumber: '15551234567',
      activationCost: '0.42',
      countryCode: '0',
      activationTime: '2026-07-02 10:00:00',
      canGetAnotherSms: true,
      raw: {},
    })),
    getStatus: vi.fn(async () => ({ state: 'waiting', code: null, lastCode: null, raw: 'STATUS_WAIT_CODE' })),
    setStatus: vi.fn(async () => ({ ok: true, raw: 'ACCESS_ACTIVATION' })),
    getTopCountriesByService: vi.fn(async () => ({})),
    ...overrides.smsClient,
  };
  const now = overrides.now ?? (() => new Date('2026-07-02T10:00:00.000Z'));
  const app = createApp({
    db,
    smsClient,
    now,
    config: {
      adminPassword: 'admin-pass',
      sessionSecret: '12345678901234567890123456789012',
      serviceCode: 'openai',
      country: '0',
      countries: '0',
      maxPrice: '',
      minPrice: '',
      qualityTier: 'any',
      activationTtlMinutes: 25,
      secureCookies: false,
      ...overrides.config,
    },
  });

  return { app, db, smsClient };
}

async function login(agent) {
  await agent.post('/admin/login').type('form').send({ password: 'admin-pass' }).expect(302);
  const adminPage = await agent.get('/admin').expect(200);
  const match = adminPage.text.match(/name="csrf-token" content="([^"]+)"/);
  expect(match?.[1]).toBeTruthy();
  return match[1];
}

function adminPost(agent, url, csrfToken) {
  return agent.post(url).set('X-CSRF-Token', csrfToken);
}

describe('admin API', () => {
  test('protects admin API routes', async () => {
    const { app } = makeTestApp();

    await request(app).get('/admin/api/keys').expect(401);
  });

  test('sets browser hardening headers', async () => {
    const { app } = makeTestApp();

    const response = await request(app).get('/').expect(200);

    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });

  test('renders a replace-number control on the public redeem page', async () => {
    const { app } = makeTestApp();

    const response = await request(app).get('/').expect(200);

    expect(response.text).toContain('id="replace-number"');
    expect(response.text).toContain('id="copy-local-number"');
  });

  test('rejects admin mutations without a CSRF token', async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    await login(agent);

    await agent.post('/admin/api/keys').send({ count: 1 }).expect(403);
  });

  test('renders admin controls for purchase settings and key search', async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    await login(agent);

    const response = await agent.get('/admin').expect(200);

    expect(response.text).toContain('id="settings-form"');
    expect(response.text).toContain('id="settings-countries"');
    expect(response.text).toContain('id="key-search-form"');
    expect(response.text).toContain('id="settings-quality-tier"');
  });

  test('saves SMSBower purchase settings from the admin API', async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    const csrfToken = await login(agent);

    await adminPost(agent, '/admin/api/settings', csrfToken)
      .send({
        serviceCode: 'oa',
        minPrice: '0.10',
        maxPrice: '0.55',
        qualityTier: 'gold',
        countries: [
          { countryCode: '39', priority: 2 },
          { countryCode: '0', priority: 1 },
        ],
      })
      .expect(200);

    const settings = await agent.get('/admin/api/settings').expect(200);

    expect(settings.body).toMatchObject({
      serviceCode: 'oa',
      minPrice: '0.10',
      maxPrice: '0.55',
      qualityTier: 'gold',
    });
    expect(settings.body.countries).toEqual([
      { countryCode: '0', priority: 1 },
      { countryCode: '39', priority: 2 },
    ]);
  });

  test('reports SMSBower health without calling balance when configuration is missing', async () => {
    const { app, smsClient } = makeTestApp({ config: { serviceCode: '' } });
    smsClient.apiKey = '';
    smsClient.serviceCode = '';
    const agent = request.agent(app);
    await login(agent);

    const health = await agent.get('/admin/api/health').expect(200);

    expect(health.body.ok).toBe(false);
    expect(health.body.missing).toEqual(['SMSBOWER_API_KEY', 'SMSBOWER_SERVICE_CODE']);
    expect(smsClient.getBalance).not.toHaveBeenCalled();
  });

  test('checks balance when SMSBower configuration is present', async () => {
    const { app, smsClient } = makeTestApp();
    smsClient.apiKey = 'key';
    smsClient.serviceCode = 'openai';
    const agent = request.agent(app);
    await login(agent);

    const health = await agent.get('/admin/api/health').expect(200);

    expect(health.body.ok).toBe(true);
    expect(health.body.balance).toBe('10.00');
    expect(smsClient.getBalance).toHaveBeenCalledOnce();
  });

  test('generates keys and only returns plaintext once', async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    const csrfToken = await login(agent);

    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 2 }).expect(201);
    expect(created.body.keys).toHaveLength(2);
    expect(created.body.keys[0].key).toMatch(/^OK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const listed = await agent.get('/admin/api/keys').expect(200);
    expect(listed.body.keys).toHaveLength(2);
    expect(listed.body.keys[0]).not.toHaveProperty('key');
    expect(listed.body.keys[0].status).toBe('unused');
  });

  test('validates keys without redeeming them', async () => {
    const { app, smsClient } = makeTestApp();
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);

    const validated = await agent
      .post('/admin/api/keys/validate')
      .set('X-CSRF-Token', csrfToken)
      .send({ key: created.body.keys[0].key })
      .expect(200);

    expect(validated.body.status).toBe('unused');
    expect(smsClient.getNumber).not.toHaveBeenCalled();
  });

  test('revokes unused keys', async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);

    await adminPost(agent, `/admin/api/keys/${created.body.keys[0].id}/revoke`, csrfToken).expect(200);

    const validated = await agent
      .post('/admin/api/keys/validate')
      .set('X-CSRF-Token', csrfToken)
      .send({ key: created.body.keys[0].key })
      .expect(200);
    expect(validated.body.status).toBe('revoked');
  });
});

describe('redeem API', () => {
  test('redeems an unused key by purchasing one number', async () => {
    const { app, smsClient } = makeTestApp();
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);

    const redeemed = await request(app)
      .post('/api/redeem')
      .send({ key: created.body.keys[0].key })
      .expect(200);

    expect(redeemed.body.status).toBe('active');
    expect(redeemed.body.phoneNumber).toBe('15551234567');
    expect(redeemed.body.expiresInSeconds).toBe(1500);
    expect(smsClient.getNumber).toHaveBeenCalledTimes(1);
  });

  test('uses saved country priority and price settings when purchasing numbers', async () => {
    const getNumber = vi.fn(async (options) => {
      if (options.country === '39') {
        throw new SmsbowerError('NO_NUMBERS', 'NO_NUMBERS');
      }
      return {
        activationId: 'act-ru',
        phoneNumber: '15551234567',
        activationCost: '0.40',
        countryCode: options.country,
        activationTime: '2026-07-02 10:00:00',
        canGetAnotherSms: true,
        raw: {},
      };
    });
    const { app } = makeTestApp({ smsClient: { getNumber } });
    const agent = request.agent(app);
    const csrfToken = await login(agent);

    await adminPost(agent, '/admin/api/settings', csrfToken)
      .send({
        serviceCode: 'oa',
        minPrice: '0.10',
        maxPrice: '0.50',
        qualityTier: 'any',
        countries: [
          { countryCode: '39', priority: 1 },
          { countryCode: '0', priority: 2 },
        ],
      })
      .expect(200);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);

    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);

    expect(getNumber).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        serviceCode: 'oa',
        country: '39',
        minPrice: '0.10',
        maxPrice: '0.50',
      }),
    );
    expect(getNumber).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        serviceCode: 'oa',
        country: '0',
        minPrice: '0.10',
        maxPrice: '0.50',
      }),
    );
  });

  test('uses Gold top provider ids when quality tier is gold', async () => {
    const getNumber = vi.fn(async (options) => ({
      activationId: 'act-gold',
      phoneNumber: '549112345678',
      activationCost: '0.42',
      countryCode: options.country,
      activationTime: '2026-07-02 10:00:00',
      canGetAnotherSms: true,
      raw: {},
    }));
    const { app, smsClient } = makeTestApp({
      smsClient: {
        getNumber,
        getTopCountriesByService: vi.fn(async () => ({
          39: {
            20: { price: '0.44', count: 10 },
            10: { price: '0.42', count: 8 },
          },
        })),
      },
    });
    const agent = request.agent(app);
    const csrfToken = await login(agent);

    await adminPost(agent, '/admin/api/settings', csrfToken)
      .send({
        serviceCode: 'oa',
        minPrice: '',
        maxPrice: '0.50',
        qualityTier: 'gold',
        countries: [{ countryCode: '39', priority: 1 }],
      })
      .expect(200);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);

    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);

    expect(smsClient.getTopCountriesByService).toHaveBeenCalledWith('oa');
    expect(getNumber).toHaveBeenCalledWith(expect.objectContaining({ country: '39', providerIds: '20,10' }));
  });

  test('returns country, dial code, and local number for Argentina activations', async () => {
    const { app } = makeTestApp({
      smsClient: {
        getNumber: vi.fn(async () => ({
          activationId: 'act-ar',
          phoneNumber: '549112345678',
          activationCost: '0.42',
          countryCode: '39',
          activationTime: '2026-07-02 10:00:00',
          canGetAnotherSms: true,
          raw: {},
        })),
      },
    });
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);

    const redeemed = await request(app)
      .post('/api/redeem')
      .send({ key: created.body.keys[0].key })
      .expect(200);

    expect(redeemed.body.phoneNumber).toBe('549112345678');
    expect(redeemed.body.countryName).toBe('Argentina');
    expect(redeemed.body.dialCode).toBe('+54');
    expect(redeemed.body.localNumber).toBe('9112345678');
  });

  test('repeated redemption returns the existing activation without buying again', async () => {
    const { app, smsClient } = makeTestApp();
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);

    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);
    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);

    expect(smsClient.getNumber).toHaveBeenCalledTimes(1);
  });

  test('polls SMSBower and marks a key used when the code arrives', async () => {
    const { app, smsClient } = makeTestApp({
      smsClient: {
        getStatus: vi.fn(async () => ({ state: 'ok', code: '123456', lastCode: null, raw: 'STATUS_OK:123456' })),
      },
    });
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);
    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);

    const status = await request(app)
      .get(`/api/redeem/${encodeURIComponent(created.body.keys[0].key)}/status`)
      .expect(200);

    expect(status.body.status).toBe('used');
    expect(status.body.code).toBe('123456');
    expect(smsClient.setStatus).toHaveBeenCalledWith('act-1', 6);
  });

  test('lists and validates a CDKey with the received SMS code', async () => {
    const { app } = makeTestApp({
      smsClient: {
        getStatus: vi.fn(async () => ({ state: 'ok', code: '123456', lastCode: null, raw: 'STATUS_OK:123456' })),
      },
    });
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);
    const key = created.body.keys[0].key;
    await request(app).post('/api/redeem').send({ key }).expect(200);
    await request(app).get(`/api/redeem/${encodeURIComponent(key)}/status`).expect(200);

    const listed = await agent.get(`/admin/api/keys?key=${encodeURIComponent(key)}`).expect(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.keys[0]).toMatchObject({
      status: 'used',
      code: '123456',
      hasCode: true,
    });

    const validated = await adminPost(agent, '/admin/api/keys/validate', csrfToken).send({ key }).expect(200);
    expect(validated.body.code).toBe('123456');
  });

  test('rejects expired active keys and cancels activation best effort', async () => {
    let currentTime = new Date('2026-07-02T10:00:00.000Z');
    const { app, smsClient } = makeTestApp({
      now: () => currentTime,
    });
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);
    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);
    currentTime = new Date('2026-07-02T10:26:00.000Z');

    const status = await request(app)
      .get(`/api/redeem/${encodeURIComponent(created.body.keys[0].key)}/status`)
      .expect(410);

    expect(status.body.status).toBe('expired');
    expect(smsClient.setStatus).toHaveBeenCalledWith('act-1', 8);
  });

  test('does not leak internal errors or stack traces to public redemption responses', async () => {
    const { app } = makeTestApp({
      smsClient: {
        getNumber: vi.fn(async () => {
          throw new Error('SMSBOWER_API_KEY=secret-value');
        }),
      },
    });
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);

    const response = await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(500);
    const bodyText = JSON.stringify(response.body);

    expect(response.body.error).toBe('Internal Server Error');
    expect(bodyText).not.toContain('secret-value');
    expect(bodyText).not.toContain('stack');
  });

  test('replaces an active waiting number by canceling it and buying a new one', async () => {
    const getNumber = vi
      .fn()
      .mockResolvedValueOnce({
        activationId: 'act-1',
        phoneNumber: '15551234567',
        activationCost: '0.42',
        countryCode: '0',
        activationTime: '2026-07-02 10:00:00',
        canGetAnotherSms: true,
        raw: {},
      })
      .mockResolvedValueOnce({
        activationId: 'act-2',
        phoneNumber: '15557654321',
        activationCost: '0.41',
        countryCode: '0',
        activationTime: '2026-07-02 10:01:00',
        canGetAnotherSms: true,
        raw: {},
      });
    const { app, smsClient } = makeTestApp({
      smsClient: {
        getNumber,
        getStatus: vi.fn(async () => ({ state: 'waiting', code: null, lastCode: null, raw: 'STATUS_WAIT_CODE' })),
      },
    });
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);
    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);

    const replaced = await request(app)
      .post(`/api/redeem/${encodeURIComponent(created.body.keys[0].key)}/replace`)
      .expect(200);

    expect(replaced.body.status).toBe('active');
    expect(replaced.body.phoneNumber).toBe('15557654321');
    expect(smsClient.getStatus).toHaveBeenCalledWith('act-1');
    expect(smsClient.setStatus).toHaveBeenCalledWith('act-1', 8);
    expect(smsClient.getNumber).toHaveBeenCalledTimes(2);
  });

  test('rejects replacement when the current number already received a code', async () => {
    const { app, smsClient } = makeTestApp({
      smsClient: {
        getStatus: vi.fn(async () => ({ state: 'ok', code: '654321', lastCode: null, raw: 'STATUS_OK:654321' })),
      },
    });
    const agent = request.agent(app);
    const csrfToken = await login(agent);
    const created = await adminPost(agent, '/admin/api/keys', csrfToken).send({ count: 1 }).expect(201);
    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);

    const response = await request(app)
      .post(`/api/redeem/${encodeURIComponent(created.body.keys[0].key)}/replace`)
      .expect(409);

    expect(response.body.code).toBe('KEY_ALREADY_USED');
    expect(smsClient.setStatus).toHaveBeenCalledWith('act-1', 6);
    expect(smsClient.setStatus).not.toHaveBeenCalledWith('act-1', 8);
    expect(smsClient.getNumber).toHaveBeenCalledTimes(1);
  });
});
