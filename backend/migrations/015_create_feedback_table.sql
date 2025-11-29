-- Migration: 015_create_feedback_table
-- Description: Create feedback table for in-app feedback submissions

CREATE TABLE feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'bug', 'feature', 'improvement', 'other'
    message TEXT NOT NULL,
    email VARCHAR(255),
    app_version VARCHAR(50),
    user_agent VARCHAR(255),
    metadata_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_user_id ON feedback(user_id);
CREATE INDEX idx_feedback_created_at ON feedback(created_at);
CREATE INDEX idx_feedback_type ON feedback(type);

COMMENT ON TABLE feedback IS 'User feedback submissions from in-app feedback tool';
COMMENT ON COLUMN feedback.type IS 'Feedback type: bug, feature, improvement, other';
COMMENT ON COLUMN feedback.metadata_json IS 'Additional metadata (screen, action, etc.)';

