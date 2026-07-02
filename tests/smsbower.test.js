import { describe, expect, test } from 'vitest';
import {
  parseBalanceResponse,
  parseNumberResponse,
  parseStatusResponse,
  SmsbowerClient,
  SmsbowerError,
} from '../src/smsbower.js';

describe('SMSBower response parsing', () => {
  test('parses legacy ACCESS_NUMBER responses', () => {
    expect(parseNumberResponse('ACCESS_NUMBER:123456:15551234567')).toEqual({
      activationId: '123456',
      phoneNumber: '15551234567',
      activationCost: null,
      countryCode: null,
      activationTime: null,
      canGetAnotherSms: null,
      raw: 'ACCESS_NUMBER:123456:15551234567',
    });
  });

  test('parses getNumberV2 JSON responses', () => {
    const response = {
      activationId: 123456,
      phoneNumber: '15551234567',
      activationCost: '0.42',
      countryCode: 0,
      canGetAnotherSms: true,
      activationTime: '2026-07-02 10:00:00',
    };

    expect(parseNumberResponse(response)).toEqual({
      activationId: '123456',
      phoneNumber: '15551234567',
      activationCost: '0.42',
      countryCode: '0',
      activationTime: '2026-07-02 10:00:00',
      canGetAnotherSms: true,
      raw: response,
    });
  });

  test('throws typed errors for documented platform error strings', () => {
    for (const code of ['BAD_KEY', 'BAD_SERVICE', 'BAD_COUNTRY', 'NO_ACTIVATION']) {
      expect(() => parseStatusResponse(code)).toThrow(SmsbowerError);
      expect(() => parseStatusResponse(code)).toThrow(code);
    }
  });

  test('parses waiting and completed SMS statuses', () => {
    expect(parseStatusResponse('STATUS_WAIT_CODE')).toEqual({
      state: 'waiting',
      code: null,
      lastCode: null,
      raw: 'STATUS_WAIT_CODE',
    });

    expect(parseStatusResponse('STATUS_OK:123456')).toEqual({
      state: 'ok',
      code: '123456',
      lastCode: null,
      raw: 'STATUS_OK:123456',
    });
  });

  test('parses retry and canceled SMS statuses', () => {
    expect(parseStatusResponse('STATUS_WAIT_RETRY:111111')).toEqual({
      state: 'retry',
      code: null,
      lastCode: '111111',
      raw: 'STATUS_WAIT_RETRY:111111',
    });

    expect(parseStatusResponse('STATUS_CANCEL')).toEqual({
      state: 'canceled',
      code: null,
      lastCode: null,
      raw: 'STATUS_CANCEL',
    });
  });

  test('parses balances', () => {
    expect(parseBalanceResponse('ACCESS_BALANCE:12.34')).toEqual({
      balance: '12.34',
      raw: 'ACCESS_BALANCE:12.34',
    });
  });

  test('passes purchase filters to getNumberV2', async () => {
    const urls = [];
    const client = new SmsbowerClient({
      apiKey: 'api-key',
      serviceCode: 'oa',
      country: '0',
      maxPrice: '0.50',
      minPrice: '0.10',
      fetchImpl: async (url) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            activationId: 123,
            phoneNumber: '549112345678',
            activationCost: '0.42',
            countryCode: 39,
          }),
        );
      },
    });

    await client.getNumber({
      country: '39',
      maxPrice: '0.45',
      minPrice: '0.20',
      providerIds: '10,11',
      exceptProviderIds: '12',
    });

    const url = urls[0];
    expect(url.searchParams.get('action')).toBe('getNumberV2');
    expect(url.searchParams.get('service')).toBe('oa');
    expect(url.searchParams.get('country')).toBe('39');
    expect(url.searchParams.get('maxPrice')).toBe('0.45');
    expect(url.searchParams.get('minPrice')).toBe('0.20');
    expect(url.searchParams.get('providerIds')).toBe('10,11');
    expect(url.searchParams.get('exceptProviderIds')).toBe('12');
  });

  test('loads top countries by service for Gold provider selection', async () => {
    const client = new SmsbowerClient({
      apiKey: 'api-key',
      serviceCode: 'oa',
      fetchImpl: async (url) => {
        expect(url.searchParams.get('action')).toBe('getTopCountriesByService');
        expect(url.searchParams.get('service')).toBe('oa');
        return new Response(JSON.stringify({ 39: { 10: { price: '0.42', count: 5 } } }));
      },
    });

    await expect(client.getTopCountriesByService('oa')).resolves.toEqual({
      39: { 10: { price: '0.42', count: 5 } },
    });
  });
});
