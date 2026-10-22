-- Fixture.espnId: caches the matched ESPN event id once livePollingJob's
-- fuzzy name match succeeds, so subsequent ESPN polls and the on-demand
-- /insights, /stats, /lineups routes can look it up directly instead of
-- re-matching by team name every time. Previously the code WROTE to a
-- column that didn't exist (`espnEventId`) and READ from another that
-- also didn't exist (`espnId`) — every livePollingJob run threw a Prisma
-- "Unknown argument" error and aborted before finishing its update loop.
ALTER TABLE `Fixture`
  ADD COLUMN `espnId` VARCHAR(64) NULL;

CREATE INDEX `Fixture_espnId_idx` ON `Fixture` (`espnId`);

-- Prediction market fields for the upgraded engine: most-likely exact
-- scoreline (read straight off the Poisson/Dixon-Coles matrix's highest
-- probability cell) and Over/Under 2.5 goals.
ALTER TABLE `Prediction`
  ADD COLUMN `predictedHomeGoals` INT NULL,
  ADD COLUMN `predictedAwayGoals` INT NULL,
  ADD COLUMN `over25Prob` DOUBLE NULL,
  ADD COLUMN `under25Prob` DOUBLE NULL,
  ADD COLUMN `predictedOver25` BOOLEAN NULL;
