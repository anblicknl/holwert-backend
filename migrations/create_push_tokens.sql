-- Push tokens tabel voor Expo Push Notifications
CREATE TABLE IF NOT EXISTS push_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  device_type VARCHAR(50), -- 'ios', 'android', 'web'
  device_name VARCHAR(255),
  notification_preferences JSONB DEFAULT '{
    "news": true,
    "agenda": true,
    "organizations": true,
    "weather": true
  }'::jsonb,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index voor snelle lookups
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token);
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(is_active);

-- Notificatie history tabel (optioneel, voor logging/analytics)
CREATE TABLE IF NOT EXISTS notification_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  push_token_id INTEGER REFERENCES push_tokens(id) ON DELETE SET NULL,
  notification_type VARCHAR(50), -- 'news', 'agenda', 'organization', 'weather'
  title VARCHAR(255),
  body TEXT,
  data JSONB,
  status VARCHAR(50), -- 'sent', 'failed', 'delivered'
  error_message TEXT,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP
);

-- Index voor notificatie history
CREATE INDEX IF NOT EXISTS idx_notification_history_user_id ON notification_history(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_type ON notification_history(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_history_sent_at ON notification_history(sent_at);

