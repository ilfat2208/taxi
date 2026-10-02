-- ---------------------------------------------------------------------------
-- Database-per-service bootstrap.
-- Runs once, on first postgres container start (empty pgdata volume).
-- Each microservice owns its schema and evolves it with Flyway migrations.
--
-- The image is postgis/postgis (PostgreSQL 16 + PostGIS), because the taxi
-- vertical stores driver positions, trip tracks and geofences as geometry.
-- PostGIS is installed per database, only where it is actually needed.
-- ---------------------------------------------------------------------------

-- marketplace vertical (frozen, still tested by the e2e scripts)
CREATE DATABASE taxi_account;
CREATE DATABASE taxi_payment;
CREATE DATABASE taxi_catalog;
CREATE DATABASE taxi_order;

-- taxi vertical
CREATE DATABASE taxi_trip;
CREATE DATABASE taxi_driver;
CREATE DATABASE taxi_dispatch;

-- service verticals (QTime: schedules and bookings for Services, Beauty, Health, Auto)
CREATE DATABASE taxi_qtime;

GRANT ALL PRIVILEGES ON DATABASE taxi_account TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_payment TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_catalog TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_order TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_trip TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_driver TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_dispatch TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE taxi_qtime TO CURRENT_USER;

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

-- trip: rides, state machine, quote snapshots, receipts
\connect taxi_trip
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS trip;

-- driver: drivers, vehicles, documents with expiry, shifts
\connect taxi_driver
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS driver;

-- dispatch: offers/assignment audit, plus the geospatial store:
-- driver positions arrive through Redis GEO, but tracks and geofences are
-- durable here (geography for metres, geometry for planar geofence maths).
\connect taxi_dispatch
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE SCHEMA IF NOT EXISTS dispatch;

-- qtime: companies, specialists, services, working schedules and bookings
\connect taxi_qtime
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS qtime;
