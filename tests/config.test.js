import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('configuration safety', () => {
  test('refuses to start with missing admin credentials', () => {
    expect(() => loadConfig({})).toThrow('ADMIN_PASSWORD');
  });

  test('refuses weak placeholder admin credentials', () => {
    expect(() =>
      loadConfig({
        ADMIN_PASSWORD: 'admin',
        SESSION_SECRET: '12345678901234567890123456789012',
      }),
    ).toThrow('ADMIN_PASSWORD');
  });

  test('refuses example placeholder credentials copied from env template', () => {
    expect(() =>
      loadConfig({
        ADMIN_PASSWORD: 'your-long-random-admin-password',
        SESSION_SECRET: '12345678901234567890123456789012',
      }),
    ).toThrow('ADMIN_PASSWORD');

    expect(() =>
      loadConfig({
        ADMIN_PASSWORD: 'strong-admin-password',
        SESSION_SECRET: 'your-32-plus-character-random-session-secret',
      }),
    ).toThrow('SESSION_SECRET');
  });

  test('requires a strong session secret', () => {
    expect(() =>
      loadConfig({
        ADMIN_PASSWORD: 'strong-admin-password',
        SESSION_SECRET: 'short',
      }),
    ).toThrow('SESSION_SECRET');
  });

  test('loads when required secret settings are explicit', () => {
    const config = loadConfig({
      ADMIN_PASSWORD: 'strong-admin-password',
      SESSION_SECRET: '12345678901234567890123456789012',
    });

    expect(config.adminPassword).toBe('strong-admin-password');
    expect(config.sessionSecret).toBe('12345678901234567890123456789012');
  });
});
