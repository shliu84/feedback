DROP TABLE IF EXISTS feedback_detail;
DROP TABLE IF EXISTS feedback;

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  user_agent TEXT,
  ip_hash TEXT,
  ref TEXT
);

CREATE INDEX idx_feedback_created_at ON feedback(created_at);
CREATE INDEX idx_feedback_rating ON feedback(rating);

CREATE TABLE feedback_detail (
  feedback_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  tags_json TEXT,
  detail TEXT,
  contact TEXT,
  ref TEXT,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
);

CREATE INDEX idx_feedback_detail_created_at ON feedback_detail(created_at);
