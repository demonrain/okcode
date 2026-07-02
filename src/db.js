import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { generateCdKey, hashKey, keyPrefix, normalizeKey } from './cdkey.js';

const VALID_KEY_STATUSES = new Set(['unused', 'active', 'used', 'expired', 'revoked']);

export function createDatabase(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cd_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('unused', 'active', 'used', 'expired', 'revoked')),
      created_at TEXT NOT NULL,
      redeemed_at TEXT,
      expires_at TEXT,
      used_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cd_key_id INTEGER NOT NULL UNIQUE REFERENCES cd_keys(id) ON DELETE CASCADE,
      activation_id TEXT NOT NULL UNIQUE,
      phone_number TEXT NOT NULL,
      code TEXT,
      status TEXT NOT NULL,
      activation_cost TEXT,
      country_code TEXT,
      activation_time TEXT,
      can_get_another_sms INTEGER,
      raw_number_response TEXT,
      raw_status_response TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cd_keys_status ON cd_keys(status);
    CREATE INDEX IF NOT EXISTS idx_cd_keys_expires_at ON cd_keys(expires_at);
  `);
}

function iso(date) {
  return date.toISOString();
}

function parseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    status: row.status,
    createdAt: row.created_at,
    redeemedAt: row.redeemed_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    activation: row.activation_id
      ? {
          id: row.activation_row_id,
          activationId: row.activation_id,
          phoneNumber: row.phone_number,
          code: row.code,
          status: row.activation_status,
          activationCost: row.activation_cost,
          countryCode: row.country_code,
          activationTime: row.activation_time,
          canGetAnotherSms: row.can_get_another_sms == null ? null : Boolean(row.can_get_another_sms),
          rawNumberResponse: row.raw_number_response,
          rawStatusResponse: row.raw_status_response,
          createdAt: row.activation_created_at,
          updatedAt: row.activation_updated_at,
        }
      : null,
  };
}

export function createRepositories(db, now = () => new Date()) {
  const selectKeyWithActivation = db.prepare(`
    SELECT
      k.*,
      a.id AS activation_row_id,
      a.activation_id,
      a.phone_number,
      a.code,
      a.status AS activation_status,
      a.activation_cost,
      a.country_code,
      a.activation_time,
      a.can_get_another_sms,
      a.raw_number_response,
      a.raw_status_response,
      a.created_at AS activation_created_at,
      a.updated_at AS activation_updated_at
    FROM cd_keys k
    LEFT JOIN activations a ON a.cd_key_id = k.id
  `);

  const insertKey = db.prepare(`
    INSERT INTO cd_keys (key_hash, key_prefix, status, created_at)
    VALUES (@keyHash, @keyPrefix, 'unused', @createdAt)
  `);

  const createKey = () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const key = generateCdKey();
      try {
        const result = insertKey.run({
          keyHash: hashKey(key),
          keyPrefix: keyPrefix(key),
          createdAt: iso(now()),
        });
        return { id: Number(result.lastInsertRowid), key, status: 'unused' };
      } catch (error) {
        if (!String(error.message).includes('UNIQUE')) throw error;
      }
    }
    throw new Error('Unable to generate a unique CDKey');
  };

  const createKeys = db.transaction((count) => {
    const keys = [];
    for (let index = 0; index < count; index += 1) {
      keys.push(createKey());
    }
    return keys;
  });

  const findByHash = db.prepare(`${selectKeyWithActivation.source} WHERE k.key_hash = ?`);
  const findById = db.prepare(`${selectKeyWithActivation.source} WHERE k.id = ?`);
  const listKeysStmt = db.prepare(`${selectKeyWithActivation.source} ORDER BY k.id DESC LIMIT ? OFFSET ?`);
  const countKeysStmt = db.prepare('SELECT COUNT(*) AS count FROM cd_keys');
  const getSettingStmt = db.prepare('SELECT value FROM app_settings WHERE name = ?');
  const upsertSettingStmt = db.prepare(`
    INSERT INTO app_settings (name, value, updated_at)
    VALUES (@name, @value, @updatedAt)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const activateKeyStmt = db.prepare(`
    UPDATE cd_keys
    SET status = 'active', redeemed_at = @redeemedAt, expires_at = @expiresAt
    WHERE id = @id AND status = 'unused'
  `);
  const insertActivationStmt = db.prepare(`
    INSERT INTO activations (
      cd_key_id, activation_id, phone_number, status, activation_cost, country_code, activation_time,
      can_get_another_sms, raw_number_response, created_at, updated_at
    )
    VALUES (
      @cdKeyId, @activationId, @phoneNumber, 'active', @activationCost, @countryCode, @activationTime,
      @canGetAnotherSms, @rawNumberResponse, @createdAt, @updatedAt
    )
  `);

  const storeActivation = db.transaction((keyId, number, expiresAt) => {
    const current = iso(now());
    const activate = activateKeyStmt.run({
      id: keyId,
      redeemedAt: current,
      expiresAt: iso(expiresAt),
    });
    if (activate.changes !== 1) {
      throw new Error('CDKey is no longer unused');
    }

    insertActivationStmt.run({
      cdKeyId: keyId,
      activationId: number.activationId,
      phoneNumber: number.phoneNumber,
      activationCost: number.activationCost,
      countryCode: number.countryCode,
      activationTime: number.activationTime,
      canGetAnotherSms: number.canGetAnotherSms == null ? null : Number(Boolean(number.canGetAnotherSms)),
      rawNumberResponse: JSON.stringify(number.raw ?? null),
      createdAt: current,
      updatedAt: current,
    });

    return parseRow(findById.get(keyId));
  });

  const updateActivationStatus = db.prepare(`
    UPDATE activations
    SET status = @status, raw_status_response = @rawStatusResponse, updated_at = @updatedAt
    WHERE cd_key_id = @cdKeyId
  `);
  const markUsedStmt = db.prepare(`
    UPDATE cd_keys
    SET status = 'used', used_at = @usedAt
    WHERE id = @id
  `);
  const saveCodeStmt = db.prepare(`
    UPDATE activations
    SET status = 'used', code = @code, raw_status_response = @rawStatusResponse, updated_at = @updatedAt
    WHERE cd_key_id = @cdKeyId
  `);
  const markExpiredStmt = db.prepare(`
    UPDATE cd_keys
    SET status = 'expired'
    WHERE id = @id AND status = 'active'
  `);
  const markActivationExpiredStmt = db.prepare(`
    UPDATE activations
    SET status = 'expired', updated_at = @updatedAt
    WHERE cd_key_id = @cdKeyId AND status = 'active'
  `);
  const revokeStmt = db.prepare(`
    UPDATE cd_keys
    SET status = 'revoked', revoked_at = @revokedAt
    WHERE id = @id AND status IN ('unused', 'active')
  `);
  const markActivationRevokedStmt = db.prepare(`
    UPDATE activations
    SET status = 'revoked', updated_at = @updatedAt
    WHERE cd_key_id = @cdKeyId
  `);
  const replaceActivationStmt = db.prepare(`
    UPDATE activations
    SET
      activation_id = @activationId,
      phone_number = @phoneNumber,
      code = NULL,
      status = 'active',
      activation_cost = @activationCost,
      country_code = @countryCode,
      activation_time = @activationTime,
      can_get_another_sms = @canGetAnotherSms,
      raw_number_response = @rawNumberResponse,
      raw_status_response = NULL,
      updated_at = @updatedAt
    WHERE cd_key_id = @cdKeyId
  `);
  const refreshActiveKeyStmt = db.prepare(`
    UPDATE cd_keys
    SET status = 'active', redeemed_at = @redeemedAt, expires_at = @expiresAt
    WHERE id = @id AND status = 'active'
  `);

  return {
    createKeys(count) {
      return createKeys(count);
    },

    findKeyByPlaintext(key) {
      return parseRow(findByHash.get(hashKey(key)));
    },

    findKeyById(id) {
      return parseRow(findById.get(id));
    },

    listKeys({ limit = 100, offset = 0 } = {}) {
      const keys = listKeysStmt.all(limit, offset).map(parseRow);
      return { keys, total: countKeysStmt.get().count };
    },

    listKeysByPlaintext(key) {
      const found = parseRow(findByHash.get(hashKey(key)));
      return { keys: found ? [found] : [], total: found ? 1 : 0 };
    },

    getSetting(name) {
      const row = getSettingStmt.get(name);
      if (!row) return null;
      return JSON.parse(row.value);
    },

    saveSetting(name, value) {
      upsertSettingStmt.run({
        name,
        value: JSON.stringify(value),
        updatedAt: iso(now()),
      });
      return value;
    },

    storeActivation,

    updateActivationStatus(keyId, status, rawStatus) {
      updateActivationStatus.run({
        cdKeyId: keyId,
        status,
        rawStatusResponse: JSON.stringify(rawStatus ?? null),
        updatedAt: iso(now()),
      });
      return parseRow(findById.get(keyId));
    },

    markUsed(keyId, code, rawStatus) {
      const current = iso(now());
      const tx = db.transaction(() => {
        markUsedStmt.run({ id: keyId, usedAt: current });
        saveCodeStmt.run({
          cdKeyId: keyId,
          code,
          rawStatusResponse: JSON.stringify(rawStatus ?? null),
          updatedAt: current,
        });
      });
      tx();
      return parseRow(findById.get(keyId));
    },

    markExpired(keyId) {
      const current = iso(now());
      const tx = db.transaction(() => {
        markExpiredStmt.run({ id: keyId });
        markActivationExpiredStmt.run({ cdKeyId: keyId, updatedAt: current });
      });
      tx();
      return parseRow(findById.get(keyId));
    },

    revokeKey(id) {
      const current = iso(now());
      const key = parseRow(findById.get(id));
      if (!key) return null;
      if (!VALID_KEY_STATUSES.has(key.status) || !['unused', 'active'].includes(key.status)) {
        return { key, changed: false };
      }
      const tx = db.transaction(() => {
        revokeStmt.run({ id, revokedAt: current });
        markActivationRevokedStmt.run({ cdKeyId: id, updatedAt: current });
      });
      tx();
      return { key: parseRow(findById.get(id)), changed: true, previous: key };
    },

    replaceActivation(keyId, number, expiresAt) {
      const current = iso(now());
      const tx = db.transaction(() => {
        const keyUpdate = refreshActiveKeyStmt.run({
          id: keyId,
          redeemedAt: current,
          expiresAt: iso(expiresAt),
        });
        if (keyUpdate.changes !== 1) {
          throw new Error('CDKey is no longer active');
        }
        const activationUpdate = replaceActivationStmt.run({
          cdKeyId: keyId,
          activationId: number.activationId,
          phoneNumber: number.phoneNumber,
          activationCost: number.activationCost,
          countryCode: number.countryCode,
          activationTime: number.activationTime,
          canGetAnotherSms: number.canGetAnotherSms == null ? null : Number(Boolean(number.canGetAnotherSms)),
          rawNumberResponse: JSON.stringify(number.raw ?? null),
          updatedAt: current,
        });
        if (activationUpdate.changes !== 1) {
          throw new Error('Activation is missing for active CDKey');
        }
      });
      tx();
      return parseRow(findById.get(keyId));
    },

    normalizeKey,
  };
}
