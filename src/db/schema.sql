-- Events: shows, concerts, standup, theater
CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  artist      TEXT,
  date        DATE NOT NULL,
  time        TIME,
  city        TEXT,
  location    TEXT,
  source      TEXT NOT NULL,   -- 'bravo' | 'leaan' | 'manual'
  link        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(title, date, location)
);

CREATE INDEX IF NOT EXISTS idx_events_date      ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_city      ON events(city);
CREATE INDEX IF NOT EXISTS idx_events_artist    ON events(artist);
CREATE INDEX IF NOT EXISTS idx_events_date_city ON events(date, city);

-- User availability queries (stored for analytics / future personalization)
CREATE TABLE IF NOT EXISTS availability_queries (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  days_of_week INTEGER[],       -- 0=Sun, 1=Mon, ..., 6=Sat
  date_from    DATE,
  date_to      DATE,
  time_from    TIME,
  preferences  JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_availability_user ON availability_queries(user_id);
