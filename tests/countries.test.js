import { describe, expect, test } from 'vitest';
import { getPhoneCountryInfo } from '../src/countries.js';

describe('phone country metadata', () => {
  test('resolves Argentina country metadata and local phone number', () => {
    expect(getPhoneCountryInfo('39', '549112345678')).toEqual({
      countryCode: '39',
      countryName: 'Argentina',
      dialCode: '+54',
      localNumber: '9112345678',
    });
  });

  test('falls back safely for unknown countries', () => {
    expect(getPhoneCountryInfo('9999', '1234567890')).toEqual({
      countryCode: '9999',
      countryName: 'Country 9999',
      dialCode: null,
      localNumber: '1234567890',
    });
  });
});
