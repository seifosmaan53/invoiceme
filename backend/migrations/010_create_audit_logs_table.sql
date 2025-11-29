CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  resource VARCHAR(50) NOT NULL,
  resource_id UUID NOT NULL,
  metadata_json JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

COMMENT ON TABLE audit_logs IS 'Audit log for tracking user actions';
COMMENT ON COLUMN audit_logs.action IS 'Action type: create, update, delete, view, export';
COMMENT ON COLUMN audit_logs.resource IS 'Resource type: client, invoice, payment, user';
COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the resource being acted upon';
COMMENT ON COLUMN audit_logs.metadata_json IS 'Additional metadata about the action';
COMMENT ON COLUMN audit_logs.ip_address IS 'IP address of the user performing the action';

