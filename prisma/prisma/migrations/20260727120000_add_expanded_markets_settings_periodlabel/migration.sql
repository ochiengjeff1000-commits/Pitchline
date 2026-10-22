-- Expanded prediction markets (football only — see predictionEngine.js
-- generatePrediction). All nullable: non-football predictions never
-- populate these, and even football predictions generated before this
-- migration will have them null until re-predicted.
ALTER TABLE `Prediction`
  ADD COLUMN `over15Prob` DOUBLE NULL,
  ADD COLUMN `under15Prob` DOUBLE NULL,
  ADD COLUMN `over35Prob` DOUBLE NULL,
  ADD COLUMN `under35Prob` DOUBLE NULL,
  ADD COLUMN `doubleChance1XProb` DOUBLE NULL,
  ADD COLUMN `doubleChance12Prob` DOUBLE NULL,
  ADD COLUMN `doubleChanceX2Prob` DOUBLE NULL,
  ADD COLUMN `dnbHomeProb` DOUBLE NULL,
  ADD COLUMN `dnbAwayProb` DOUBLE NULL,
  ADD COLUMN `cleanSheetHomeProb` DOUBLE NULL,
  ADD COLUMN `cleanSheetAwayProb` DOUBLE NULL,
  ADD COLUMN `oddTotalProb` DOUBLE NULL,
  ADD COLUMN `evenTotalProb` DOUBLE NULL,
  ADD COLUMN `correctScoreTop3` JSON NULL;

-- Sport-appropriate period label (e.g. "Q3", "2nd Period") — a bare
-- `elapsed` integer is ambiguous for period-based sports (could be a
-- countdown within the period, not total match minutes), so the live UI
-- was previously at risk of showing a misleading "67'" style badge for
-- e.g. a basketball game. This lets the backend supply the real label.
ALTER TABLE `Fixture`
  ADD COLUMN `periodLabel` VARCHAR(24) NULL;

-- Runtime-configurable admin settings (unlock price, free-mode toggle,
-- etc) — previously these required an env var change + redeploy.
CREATE TABLE `AdminSetting` (
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4;
