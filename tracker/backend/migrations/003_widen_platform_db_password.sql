-- Tracker migration 003
-- interfaceconfiguration.Platform_DB_Password is VARCHAR(50) but the tracker stores
-- the 5 secret columns encrypted (enc:v1:<base64…>, ~70+ chars). Widen it to match
-- the other secret columns (VARCHAR(500)).
ALTER TABLE interfaceconfiguration MODIFY Platform_DB_Password VARCHAR(500);
