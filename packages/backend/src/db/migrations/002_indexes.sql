CREATE INDEX idx_sync_logs_connection_ts ON sync_logs(connection_id, ts DESC);
CREATE INDEX idx_sync_logs_level ON sync_logs(level);
