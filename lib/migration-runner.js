"use strict";

function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    checksum TEXT
  )`);
}

function hasMigration(db, version) {
  return Boolean(db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version));
}

function runMigrations(db, migrations) {
  ensureMigrationTable(db);
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    if (hasMigration(db, migration.version)) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations(version, name, checksum) VALUES(?,?,?)")
        .run(migration.version, migration.name, migration.checksum || null);
    });
    apply();
  }
}

function runLegacyAlter(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    const message = String(error?.message || error);
    if (/duplicate column name|already exists/i.test(message)) return false;
    throw error;
  }
  return true;
}

module.exports = { ensureMigrationTable, hasMigration, runMigrations, runLegacyAlter };
