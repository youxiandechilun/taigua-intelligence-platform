CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sso_tickets (
    ticket_hash TEXT PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    agent_slug TEXT NOT NULL,
    parent_token TEXT NOT NULL,
    expire_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_sessions (
    token_hash TEXT PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    agent_slug TEXT NOT NULL,
    parent_token TEXT NOT NULL,
    expire_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_parent ON agent_sessions(parent_token);
CREATE TABLE IF NOT EXISTS agent_prices (
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    action TEXT NOT NULL,
    points INTEGER NOT NULL CHECK(points >= 0),
    daily_cap INTEGER NOT NULL DEFAULT 0 CHECK(daily_cap >= 0),
    PRIMARY KEY(agent_id, action)
);
CREATE TABLE IF NOT EXISTS point_consumptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    action TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    points INTEGER NOT NULL,
    status TEXT NOT NULL,
    fail_reason TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consumptions_owner ON point_consumptions(merchant_id, id);
CREATE TABLE IF NOT EXISTS point_holds (
    hold_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    action TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    held INTEGER NOT NULL,
    charged INTEGER NOT NULL DEFAULT 0,
    actual_quantity INTEGER,
    usage_day TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserved',
    reason TEXT NOT NULL DEFAULT '',
    expire_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holds_expiry ON point_holds(status, expire_at);
CREATE TABLE IF NOT EXISTS agent_usage_daily (
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    action TEXT NOT NULL,
    day TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    reserved_quantity INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(merchant_id, agent_id, action, day)
);
CREATE TABLE IF NOT EXISTS agent_identities (
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    agent_slug TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    external_org_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY(merchant_id, agent_slug)
);
CREATE TABLE IF NOT EXISTS integration_configs (
    agent_slug TEXT NOT NULL,
    section TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(agent_slug, section)
);
