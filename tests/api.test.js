import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

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
      maxPrice: '',
      minPrice: '',
      activationTtlMinutes: 25,
      secureCookies: false,
    },
  });

  return { app, db, smsClient };
}

async function login(agent) {
  await agent.post('/admin/login').type('form').send({ password: 'admin-pass' }).expect(302);
}

describe('admin API', () => {
  test('protects admin API routes', async () => {
    const { app } = makeTestApp();

    await request(app).get('/admin/api/keys').expect(401);
  });

  test('reports SMSBower health without calling balance when configuration is missing', async () => {
    const { app, smsClient } = makeTestApp();
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
    await login(agent);

    const created = await agent.post('/admin/api/keys').send({ count: 2 }).expect(201);
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
    await login(agent);
    const created = await agent.post('/admin/api/keys').send({ count: 1 }).expect(201);

    const validated = await agent
      .post('/admin/api/keys/validate')
      .send({ key: created.body.keys[0].key })
      .expect(200);

    expect(validated.body.status).toBe('unused');
    expect(smsClient.getNumber).not.toHaveBeenCalled();
  });

  test('revokes unused keys', async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    await login(agent);
    const created = await agent.post('/admin/api/keys').send({ count: 1 }).expect(201);

    await agent.post(`/admin/api/keys/${created.body.keys[0].id}/revoke`).expect(200);

    const validated = await agent
      .post('/admin/api/keys/validate')
      .send({ key: created.body.keys[0].key })
      .expect(200);
    expect(validated.body.status).toBe('revoked');
  });
});

describe('redeem API', () => {
  test('redeems an unused key by purchasing one number', async () => {
    const { app, smsClient } = makeTestApp();
    const agent = request.agent(app);
    await login(agent);
    const created = await agent.post('/admin/api/keys').send({ count: 1 }).expect(201);

    const redeemed = await request(app)
      .post('/api/redeem')
      .send({ key: created.body.keys[0].key })
      .expect(200);

    expect(redeemed.body.status).toBe('active');
    expect(redeemed.body.phoneNumber).toBe('15551234567');
    expect(redeemed.body.expiresInSeconds).toBe(1500);
    expect(smsClient.getNumber).toHaveBeenCalledTimes(1);
  });

  test('repeated redemption returns the existing activation without buying again', async () => {
    const { app, smsClient } = makeTestApp();
    const agent = request.agent(app);
    await login(agent);
    const created = await agent.post('/admin/api/keys').send({ count: 1 }).expect(201);

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
    await login(agent);
    const created = await agent.post('/admin/api/keys').send({ count: 1 }).expect(201);
    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);

    const status = await request(app)
      .get(`/api/redeem/${encodeURIComponent(created.body.keys[0].key)}/status`)
      .expect(200);

    expect(status.body.status).toBe('used');
    expect(status.body.code).toBe('123456');
    expect(smsClient.setStatus).toHaveBeenCalledWith('act-1', 6);
  });

  test('rejects expired active keys and cancels activation best effort', async () => {
    let currentTime = new Date('2026-07-02T10:00:00.000Z');
    const { app, smsClient } = makeTestApp({
      now: () => currentTime,
    });
    const agent = request.agent(app);
    await login(agent);
    const created = await agent.post('/admin/api/keys').send({ count: 1 }).expect(201);
    await request(app).post('/api/redeem').send({ key: created.body.keys[0].key }).expect(200);
    currentTime = new Date('2026-07-02T10:26:00.000Z');

    const status = await request(app)
      .get(`/api/redeem/${encodeURIComponent(created.body.keys[0].key)}/status`)
      .expect(410);

    expect(status.body.status).toBe('expired');
    expect(smsClient.setStatus).toHaveBeenCalledWith('act-1', 8);
  });
});
