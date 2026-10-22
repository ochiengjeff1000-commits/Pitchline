-- Tracks which team pairs we've already queried API-Sports' head-to-head
-- endpoint for, so pairs with genuinely no shared history (or that were
-- checked recently) don't get re-queried on every insights view.
CREATE TABLE `H2hLookup` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `teamAId` INT NOT NULL,
  `teamBId` INT NOT NULL,
  `meetingsFound` INT NOT NULL DEFAULT 0,
  `lastCheckedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `H2hLookup_teamAId_teamBId_key` (`teamAId`, `teamBId`)
) DEFAULT CHARACTER SET utf8mb4;
