import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../src/format.js';

describe('formatDateTime', () => {
  it('formats ISO timestamps as yyyy-MM-dd hh:mm:ss', () => {
    expect(formatDateTime('2026-07-04T03:15:31.871Z')).toBe('2026-07-04 03:15:31');
  });

  it('returns null for empty values', () => {
    expect(formatDateTime(null)).toBeNull();
    expect(formatDateTime('')).toBeNull();
  });
});
