import { describe, expect, test } from 'vitest';
import {
  parseBalanceResponse,
  parseNumberResponse,
  parseStatusResponse,
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
});
