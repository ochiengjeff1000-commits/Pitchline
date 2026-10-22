-- Betika's 3rd jackpot product ("Sababisha") alongside Grand/Midweek —
-- see config/jackpotPlatforms.js.
ALTER TABLE `Jackpot` MODIFY COLUMN `type` ENUM('MIDWEEK', 'MEGA', 'GRAND', 'DAILY', 'WEEKLY', 'SABABISHA') NOT NULL;

-- Marks teams/leagues/fixtures auto-created by jackpotIngestion when a
-- synced jackpot leg doesn't match anything the daily sync has already
-- populated — see services/jackpotIngestion.js resolveOrCreateFixture().
ALTER TABLE `Team` MODIFY COLUMN `provider` ENUM('API_SPORTS', 'FOOTBALL_DATA', 'JACKPOT_MANUAL') NOT NULL DEFAULT 'API_SPORTS';
ALTER TABLE `League` MODIFY COLUMN `provider` ENUM('API_SPORTS', 'FOOTBALL_DATA', 'JACKPOT_MANUAL') NOT NULL DEFAULT 'API_SPORTS';
ALTER TABLE `Fixture` MODIFY COLUMN `provider` ENUM('API_SPORTS', 'FOOTBALL_DATA', 'JACKPOT_MANUAL') NOT NULL DEFAULT 'API_SPORTS';

-- Cached analysis snapshot on JackpotSelection ("JackpotItem") — written
-- at ingest time straight from the freshly-generated Prediction, so the
-- Jackpots tab can render 1X2 + confidence for every leg with zero extra
-- joins/regeneration, and so a leg synced with no pre-existing fixture
-- still shows its analysis immediately (see Task 4: automated jackpot
-- sync & analysis pipeline).
ALTER TABLE `JackpotSelection`
  ADD COLUMN `analysisProbHome` DOUBLE NULL,
  ADD COLUMN `analysisProbDraw` DOUBLE NULL,
  ADD COLUMN `analysisProbAway` DOUBLE NULL,
  ADD COLUMN `analysisPredictedOutcome` ENUM('HOME', 'DRAW', 'AWAY') NULL,
  ADD COLUMN `analysisConfidence` DOUBLE NULL,
  ADD COLUMN `analysisJustification` TEXT NULL,
  ADD COLUMN `analyzedAt` DATETIME(3) NULL;
