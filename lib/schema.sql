CREATE TABLE IF NOT EXISTS cities (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS clusters (id INTEGER PRIMARY KEY, city_id INTEGER NOT NULL REFERENCES cities(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY, cluster_id INTEGER NOT NULL REFERENCES clusters(id), name TEXT NOT NULL,
  lat REAL, lng REAL, cbm_id INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT,
  access_role TEXT NOT NULL CHECK (access_role IN ('admin','reviewer','auditor','cbm','ground')),
  op_role TEXT
);
CREATE TABLE IF NOT EXISTS user_properties (user_id INTEGER NOT NULL, property_id INTEGER NOT NULL, PRIMARY KEY (user_id, property_id));

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, op_role TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'scheduled',      -- scheduled | event | on_demand
  event_name TEXT,                                -- for trigger=event, e.g. 'Tenant exited'
  frequency TEXT NOT NULL DEFAULT 'daily',        -- daily | weekly | monthly | once
  weekday INTEGER,                                -- 0-6 for weekly
  window_start TEXT NOT NULL DEFAULT '10:00', window_end TEXT NOT NULL DEFAULT '12:00',
  review_sla_h INTEGER NOT NULL DEFAULT 24, audit_sla_h INTEGER NOT NULL DEFAULT 48,
  attempts_allowed INTEGER NOT NULL DEFAULT 3, late_window_days INTEGER NOT NULL DEFAULT 1,
  criticality TEXT NOT NULL DEFAULT 'normal',     -- normal | high
  audit_rate REAL NOT NULL DEFAULT 0.2,
  geofence INTEGER NOT NULL DEFAULT 1,
  reviewer_id INTEGER REFERENCES users(id), auditor_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS template_items (
  id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES templates(id), pos INTEGER NOT NULL,
  label TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'check',   -- check | number | text
  photo_required INTEGER NOT NULL DEFAULT 0, note_required INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS template_properties (template_id INTEGER NOT NULL, property_id INTEGER NOT NULL, PRIMARY KEY (template_id, property_id));

CREATE TABLE IF NOT EXISTS instances (
  id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES templates(id), property_id INTEGER NOT NULL REFERENCES properties(id),
  task_date TEXT NOT NULL, window_start_at INTEGER NOT NULL, window_end_at INTEGER NOT NULL, late_until_at INTEGER NOT NULL,
  assignee_id INTEGER REFERENCES users(id), reviewer_id INTEGER REFERENCES users(id), auditor_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'upcoming',
  -- upcoming | current | notsub | missed | waived | review | changes | resub | audit | auditflag | flagans | done | notrect
  attempt INTEGER NOT NULL DEFAULT 0,
  first_submitted_at INTEGER, last_submitted_at INTEGER, status_since INTEGER NOT NULL,
  first_decision TEXT, closed_at INTEGER, source TEXT NOT NULL DEFAULT 'schedule',
  UNIQUE (template_id, property_id, task_date, source)
);
CREATE INDEX IF NOT EXISTS ix_inst_status ON instances(status);
CREATE INDEX IF NOT EXISTS ix_inst_date ON instances(task_date);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY, instance_id INTEGER NOT NULL REFERENCES instances(id), attempt INTEGER NOT NULL,
  submitted_by INTEGER REFERENCES users(id), submitted_at INTEGER NOT NULL, location_ok INTEGER, distance_m INTEGER
);
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id), item_id INTEGER NOT NULL REFERENCES template_items(id),
  checked INTEGER NOT NULL DEFAULT 0, value TEXT, note TEXT, photos TEXT NOT NULL DEFAULT '[]', reply TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY, instance_id INTEGER NOT NULL REFERENCES instances(id), submission_id INTEGER REFERENCES submissions(id),
  reviewer_id INTEGER REFERENCES users(id), kind TEXT NOT NULL,      -- review | audit
  decision TEXT NOT NULL,                                            -- pass | changes | fail
  opened_at INTEGER, decided_at INTEGER NOT NULL, due_at INTEGER, comment TEXT
);
CREATE TABLE IF NOT EXISTS review_flags (
  id INTEGER PRIMARY KEY, review_id INTEGER NOT NULL REFERENCES reviews(id), item_id INTEGER NOT NULL REFERENCES template_items(id),
  reason TEXT NOT NULL, comment TEXT, answer TEXT, answered_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, instance_id INTEGER NOT NULL REFERENCES instances(id), at INTEGER NOT NULL,
  actor_id INTEGER REFERENCES users(id), type TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS ix_events_inst ON events(instance_id);
CREATE TABLE IF NOT EXISTS saved_views (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  filters TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
-- Housekeeping headcount per property: ideal (as planned) vs current (on the roster). HK = housekeeper, SHK = senior housekeeper / supervisor.
CREATE TABLE IF NOT EXISTS staffing (
  property_id INTEGER PRIMARY KEY REFERENCES properties(id),
  ideal_hk INTEGER NOT NULL, current_hk INTEGER NOT NULL, ideal_shk INTEGER NOT NULL, current_shk INTEGER NOT NULL
);
