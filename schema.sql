PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS Payments;
DROP TABLE IF EXISTS Orders;
DROP TABLE IF EXISTS Logs;

CREATE TABLE Logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    message TEXT,
    subject TEXT,
    status TEXT,
    error_message TEXT
);

CREATE TABLE Orders (
    order_id TEXT PRIMARY KEY,
    amount NUMERIC NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('waiting', 'success', 'timeout')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uid TEXT NULL,
    payer_name TEXT NULL,
    paid_at TEXT NULL
);

CREATE INDEX idx_orders_uid ON Orders(uid);
CREATE INDEX idx_orders_status ON Orders(status);

CREATE TABLE Payments (
    payment_id TEXT PRIMARY KEY,
    amount NUMERIC NOT NULL,
    uid TEXT NOT NULL UNIQUE,
    payer_name TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    matched_order_id TEXT NULL,
    FOREIGN KEY (matched_order_id) REFERENCES Orders(order_id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX idx_payments_matched_order_id ON Payments(matched_order_id);

