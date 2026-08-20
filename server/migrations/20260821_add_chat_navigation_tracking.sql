-- Track when users navigate to map from chat messages
CREATE TABLE IF NOT EXISTS chat_navigation_events (
    id BIGSERIAL PRIMARY KEY,
    chat_message_id INT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    destination_id INT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    session_id INT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    navigated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_chat_navigation_message_id ON chat_navigation_events(chat_message_id);
CREATE INDEX IF NOT EXISTS idx_chat_navigation_destination_id ON chat_navigation_events(destination_id);
CREATE INDEX IF NOT EXISTS idx_chat_navigation_user_id ON chat_navigation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_navigation_session_id ON chat_navigation_events(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_navigation_navigated_at ON chat_navigation_events(navigated_at DESC);