-- Migration: Add local_id column to patients table
-- This fixes the sync issue where local_id column was missing

ALTER TABLE patients 
ADD COLUMN local_id VARCHAR(50) AFTER id,
ADD INDEX idx_local_id (local_id);

-- Mark any existing records to ensure they can be synced properly
UPDATE patients SET synced = false WHERE synced = true;
