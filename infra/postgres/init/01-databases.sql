-- ---------------------------------------------------------------------------
-- Database-per-service bootstrap.
-- Runs once, on first postgres container start (empty pgdata volume).
-- Each microservice owns its schema and evolves it with Flyway migrations.
-- ---------------------------------------------------------------------------

CREATE DATABASE taxi_account;
CREATE DATABASE taxi_payment;
CREATE DATABASE taxi_catalog;
CREATE DATABASE taxi_order;

GRANT ALL PRIVILEGES ON DATABASE taxi_account TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_payment TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_catalog TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_order TO CURRENT_USER;

\connect taxi_account
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS account;

\connect taxi_payment
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS payment;

\connect taxi_catalog
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE SCHEMA IF NOT EXISTS catalog;

\connect taxi_order
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS orders;
