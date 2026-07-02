import session from 'express-session';

export class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStmt = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare(`
      INSERT INTO sessions (sid, expires_at, data)
      VALUES (@sid, @expiresAt, @data)
      ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data
    `);
    this.deleteStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  }

  get(sid, callback) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.deleteStmt.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback) {
    try {
      const expiresAt = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      this.setStmt.run({ sid, expiresAt, data: JSON.stringify(sess) });
      this.deleteExpiredStmt.run(Date.now());
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.deleteStmt.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}
