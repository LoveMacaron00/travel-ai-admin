-- =============================================================
-- Migration: Replace icon with icon_url TEXT in plan_preference_options
-- =============================================================

-- 1. Drop old icon column and add icon_url column
ALTER TABLE plan_preference_options DROP COLUMN IF EXISTS icon;
ALTER TABLE plan_preference_options ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- 2. Clear icon_url for interests (interests do not use icons)
UPDATE plan_preference_options SET icon_url = NULL WHERE type = 'interest';

-- 3. Populate default image icon paths ONLY for transport_mode options
UPDATE plan_preference_options SET icon_url = '/uploads/preferences/car.png' WHERE key = 'car';
UPDATE plan_preference_options SET icon_url = '/uploads/preferences/walking.png' WHERE key = 'walking';
UPDATE plan_preference_options SET icon_url = '/uploads/preferences/bus.png' WHERE key = 'bus';
UPDATE plan_preference_options SET icon_url = '/uploads/preferences/train.png' WHERE key = 'train';
UPDATE plan_preference_options SET icon_url = '/uploads/preferences/ferry.png' WHERE key = 'ferry';
UPDATE plan_preference_options SET icon_url = '/uploads/preferences/flight.png' WHERE key = 'flight';
