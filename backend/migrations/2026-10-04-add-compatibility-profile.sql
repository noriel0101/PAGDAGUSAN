-- Compatibility profile for roommate scoring.
-- Existing smoking and drinking answers stay. New answers are optional.
-- Idempotent: safe to re-run; never drops existing rows.

ALTER TABLE tenant_lifestyles
  ADD COLUMN IF NOT EXISTS budget_max NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS room_share TEXT,
  ADD COLUMN IF NOT EXISTS sleep_schedule TEXT,
  ADD COLUMN IF NOT EXISTS cleanliness SMALLINT,
  ADD COLUMN IF NOT EXISTS noise_tolerance TEXT,
  ADD COLUMN IF NOT EXISTS study_habit TEXT,
  ADD COLUMN IF NOT EXISTS social_preference TEXT,
  ADD COLUMN IF NOT EXISTS pet_preference TEXT,
  ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_budget_max_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_budget_max_check
      CHECK (budget_max IS NULL OR budget_max >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_room_share_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_room_share_check
      CHECK (room_share IS NULL OR room_share IN ('private', 'either', 'shared'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_sleep_schedule_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_sleep_schedule_check
      CHECK (sleep_schedule IS NULL OR sleep_schedule IN ('early', 'flexible', 'late'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_cleanliness_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_cleanliness_check
      CHECK (cleanliness IS NULL OR cleanliness BETWEEN 1 AND 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_noise_tolerance_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_noise_tolerance_check
      CHECK (noise_tolerance IS NULL OR noise_tolerance IN ('quiet', 'moderate', 'lively'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_study_habit_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_study_habit_check
      CHECK (study_habit IS NULL OR study_habit IN ('alone', 'mixed', 'group'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_social_preference_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_social_preference_check
      CHECK (social_preference IS NULL OR social_preference IN ('private', 'balanced', 'social'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_pet_preference_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_pet_preference_check
      CHECK (pet_preference IS NULL OR pet_preference IN ('no_pets', 'ok_with_pets', 'has_pets'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_lifestyles_interests_check' AND conrelid = 'tenant_lifestyles'::regclass
  ) THEN
    ALTER TABLE tenant_lifestyles
      ADD CONSTRAINT tenant_lifestyles_interests_check
      CHECK (cardinality(interests) <= 8);
  END IF;
END $$;
