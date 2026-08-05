-- =====================================================
-- Absensi RMJ Masjid Jogokariyan - Database Schema
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(20) NOT NULL CHECK (role IN ('superadmin', 'coordinator', 'facilitator')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  schedule_info VARCHAR(255),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coordinator_activities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  UNIQUE(user_id, activity_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  facilitator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  nickname VARCHAR(50),
  birth_date DATE,
  address TEXT,
  rt VARCHAR(5),
  rw VARCHAR(5),
  guardian_name VARCHAR(100),
  guardian_whatsapp VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add birth_date to participants created before this column existed
ALTER TABLE participants ADD COLUMN IF NOT EXISTS birth_date DATE;

CREATE TABLE IF NOT EXISTS group_participants (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(group_id, participant_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  planned_start TIME,
  planned_end TIME,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
);

-- Add planned start/end time to sessions created before these columns existed
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS planned_start TIME;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS planned_end TIME;

CREATE TABLE IF NOT EXISTS attendances (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  present BOOLEAN DEFAULT false,
  wa_sent BOOLEAN DEFAULT false,
  marked_at TIMESTAMP,
  UNIQUE(session_id, participant_id)
);

CREATE TABLE IF NOT EXISTS message_templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('attendance', 'session_end')),
  template_text TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique indexes for message_templates (handling NULL user_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mt_user_type ON message_templates(user_id, type) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mt_global_type ON message_templates(type) WHERE user_id IS NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_groups_activity ON groups(activity_id);
CREATE INDEX IF NOT EXISTS idx_groups_facilitator ON groups(facilitator_id);
CREATE INDEX IF NOT EXISTS idx_gp_group ON group_participants(group_id);
CREATE INDEX IF NOT EXISTS idx_gp_participant ON group_participants(participant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_att_session ON attendances(session_id);
CREATE INDEX IF NOT EXISTS idx_att_participant ON attendances(participant_id);
CREATE INDEX IF NOT EXISTS idx_ca_user ON coordinator_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_ca_activity ON coordinator_activities(activity_id);

-- Seed default activities
INSERT INTO activities (name, description, schedule_info) VALUES
  ('Siber', 'Sinau Bareng - Kegiatan belajar bersama', 'Setiap Minggu'),
  ('SaturdayNight', 'Kegiatan malam Sabtu remaja masjid', 'Setiap Sabtu malam'),
  ('TPA', 'Taman Pendidikan Al-Quran', 'Senin - Jumat')
ON CONFLICT (name) DO NOTHING;

-- Seed default global message templates
INSERT INTO message_templates (user_id, type, template_text) VALUES
  (NULL, 'attendance', E'Assalamu\'alaikum Bapak/Ibu {nama_wali},\n\nKami informasikan bahwa putra/putri Bapak/Ibu yang bernama {nama_anak} telah hadir dalam kegiatan {kegiatan} - {kelompok} di Masjid Jogokariyan pada {tanggal} pukul {waktu}.\n\nJazakumullahu khairan.\n🕌 RMJ Masjid Jogokariyan')
ON CONFLICT DO NOTHING;

INSERT INTO message_templates (user_id, type, template_text) VALUES
  (NULL, 'session_end', E'Assalamu\'alaikum Bapak/Ibu {nama_wali},\n\nKegiatan {kegiatan} - {kelompok} pada {tanggal} telah selesai. Putra/putri Bapak/Ibu yang bernama {nama_anak} sudah bisa dijemput.\n\nJazakumullahu khairan.\n🕌 RMJ Masjid Jogokariyan')
ON CONFLICT DO NOTHING;
