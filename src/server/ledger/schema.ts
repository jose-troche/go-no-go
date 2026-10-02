// DO SQLite schema (implementation guide 7.5). Writes are the scarce resource: minimal indexes.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    sim_time REAL NOT NULL,
    abs_time REAL NOT NULL,
    created_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    domain TEXT NOT NULL,
    entity TEXT NOT NULL,
    attribute TEXT NOT NULL,
    value TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ref TEXT,
    asserted_by TEXT NOT NULL,
    station TEXT NOT NULL,
    confidence REAL NOT NULL,
    vis_full TEXT NOT NULL,
    vis_summary TEXT NOT NULL,
    derived_from TEXT NOT NULL DEFAULT '[]',
    supersedes TEXT,
    valid_until REAL,
    promoted_by TEXT
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS facts_entity_attr ON facts(entity, attribute, seq)`,
  `CREATE TABLE IF NOT EXISTS room_config (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS action_log (
    seq INTEGER PRIMARY KEY,
    sim_time REAL NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL
  )`,
];

export interface FactRow {
  id: string;
  seq: number;
  sim_time: number;
  abs_time: number;
  created_at: number;
  kind: string;
  domain: string;
  entity: string;
  attribute: string;
  value: string;
  summary_text: string;
  source_type: string;
  source_ref: string | null;
  asserted_by: string;
  station: string;
  confidence: number;
  vis_full: string;
  vis_summary: string;
  derived_from: string;
  supersedes: string | null;
  valid_until: number | null;
  promoted_by: string | null;
}
