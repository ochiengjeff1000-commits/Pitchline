-- Team profile fields (country, venue, cached squad) — all backfilled
-- on-demand by teamProfileService.js, never by the daily sync, so
-- existing rows just start NULL until a user actually opens that team.
ALTER TABLE `Team`
  ADD COLUMN `country` VARCHAR(191) NULL,
  ADD COLUMN `venueName` VARCHAR(191) NULL,
  ADD COLUMN `venueCity` VARCHAR(191) NULL,
  ADD COLUMN `squadJson` JSON NULL,
  ADD COLUMN `squadCachedAt` DATETIME(3) NULL,
  ADD COLUMN `profileCheckedAt` DATETIME(3) NULL;

-- Cached standings per league+season, refreshed on a TTL rather than
-- fetched fresh on every team-profile view.
CREATE TABLE `StandingsCache` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `leagueId` INT NOT NULL,
  `season` INT NOT NULL,
  `data` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `StandingsCache_leagueId_season_key` (`leagueId`, `season`)
) DEFAULT CHARACTER SET utf8mb4;
