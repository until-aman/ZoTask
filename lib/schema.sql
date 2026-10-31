CREATE TABLE IF NOT EXISTS cities (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS clusters (id INTEGER PRIMARY KEY, city_id INTEGER NOT NULL REFERENCES cities(id), name TEXT NOT NULL,
  reviewer_id INTEGER REFERENCES users(id), auditor_id INTEGER REFERENCES users(id), archived INTEGER NOT NULL DEFAULT 0);
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
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  events TEXT NOT NULL DEFAULT '[]',              -- trigger=event: every event that creates the task (JSON list)
  days TEXT NOT NULL DEFAULT '[]',                -- weekly: weekdays 0-6; monthly: days 1-31 (JSON list)
  once_date TEXT,                                 -- frequency=once
  start_stop INTEGER NOT NULL DEFAULT 1,          -- assignee taps Start and Stop to track time
  geofence_m INTEGER NOT NULL DEFAULT 200,        -- maximum distance from the property when location is checked
  ideal_minutes INTEGER,                          -- shown to the assignee as "Ideal: 30 min"
  review_required INTEGER NOT NULL DEFAULT 1,     -- off: a submission counts as done straight away
  assignees TEXT NOT NULL DEFAULT '[]'            -- named people (JSON list of user ids); empty means anyone with the role
);
CREATE TABLE IF NOT EXISTS template_items (
  id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES templates(id), pos INTEGER NOT NULL,
  label TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'check',   -- check | number | text
  photo_required INTEGER NOT NULL DEFAULT 0, note_required INTEGER NOT NULL DEFAULT 0,
  photo_allowed INTEGER NOT NULL DEFAULT 1, note_allowed INTEGER NOT NULL DEFAULT 1,  -- allowed = shown; required = compulsory
  count_of TEXT                                   -- kind=count: HK or SHK, checked against the property's ideal count
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
  filters TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
  page TEXT NOT NULL DEFAULT 'queue'                -- which screen the filters belong to
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
-- Housekeeping headcount per property: ideal (as planned) vs current (on the roster). HK = housekeeper, SHK = senior housekeeper / supervisor.
CREATE TABLE IF NOT EXISTS staffing (
  property_id INTEGER PRIMARY KEY REFERENCES properties(id),
  ideal_hk INTEGER NOT NULL, current_hk INTEGER NOT NULL, ideal_shk INTEGER NOT NULL, current_shk INTEGER NOT NULL
);
-- Lookups used by the dashboard and review pages.
CREATE INDEX IF NOT EXISTS ix_rev_inst ON reviews(instance_id, decided_at);
CREATE INDEX IF NOT EXISTS ix_rev_sub ON reviews(submission_id);
CREATE INDEX IF NOT EXISTS ix_rev_decided ON reviews(decided_at);
CREATE INDEX IF NOT EXISTS ix_flag_rev ON review_flags(review_id);
CREATE INDEX IF NOT EXISTS ix_sub_inst ON submissions(instance_id);
CREATE INDEX IF NOT EXISTS ix_events_type_at ON events(type, at);
-- Escalations raised by the central team (replaces the per-person action item sheets).
CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY, department TEXT NOT NULL, title TEXT NOT NULL, detail TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',                          -- high | medium | low
  status TEXT NOT NULL DEFAULT 'open',                              -- open | wip | done | dropped
  raised_by INTEGER NOT NULL REFERENCES users(id),
  owner_name TEXT NOT NULL, owner_email TEXT, owner_id INTEGER REFERENCES users(id), cc TEXT,
  mail_subject TEXT, mail_sent_at INTEGER, link TEXT,
  due_date TEXT,                                                    -- expected closure
  photos TEXT NOT NULL DEFAULT '[]', instance_id INTEGER REFERENCES instances(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS escalation_properties (escalation_id INTEGER NOT NULL REFERENCES escalations(id), property_id INTEGER NOT NULL REFERENCES properties(id), PRIMARY KEY (escalation_id, property_id));
CREATE TABLE IF NOT EXISTS escalation_updates (
  id INTEGER PRIMARY KEY, escalation_id INTEGER NOT NULL REFERENCES escalations(id), at INTEGER NOT NULL,
  by_id INTEGER REFERENCES users(id), note TEXT, status TEXT, due_date TEXT
);
CREATE INDEX IF NOT EXISTS ix_escu ON escalation_updates(escalation_id, at);
-- Admin libraries.
CREATE TABLE IF NOT EXISTS task_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, pos INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS checklist_presets (id INTEGER PRIMARY KEY, title TEXT NOT NULL, items TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS schedule_presets (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, frequency TEXT NOT NULL DEFAULT 'daily', days TEXT NOT NULL DEFAULT '[]', once_date TEXT,
  window_start TEXT NOT NULL DEFAULT '09:00', window_end TEXT NOT NULL DEFAULT '10:00'
);
