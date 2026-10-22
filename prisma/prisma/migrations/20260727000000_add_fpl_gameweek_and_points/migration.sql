-- Actual points scored for a gameweek's squad, backfilled once that
-- gameweek finishes (null beforehand — distinguishes "not played yet"
-- from "scored zero").
ALTER TABLE `FplSquadRecommendation`
  ADD COLUMN `totalPointsEarned` INT NULL;

-- Per-gameweek metadata (deadline, current/next/finished flags) pulled
-- from FPL's bootstrap `events` array — previously not stored anywhere,
-- so the frontend had no way to show a deadline countdown or know which
-- past gameweeks are safe to backfill real points for.
CREATE TABLE `FplGameweek` (
  `id` INT NOT NULL,
  `deadlineTime` DATETIME(3) NULL,
  `isCurrent` BOOLEAN NOT NULL DEFAULT false,
  `isNext` BOOLEAN NOT NULL DEFAULT false,
  `finished` BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;
