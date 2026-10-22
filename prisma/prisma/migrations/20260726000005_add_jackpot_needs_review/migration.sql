-- Adds NEEDS_REVIEW as a JackpotStatus value — quick-paste and future
-- auto-source-adapter ingested jackpots land here first (hidden from the
-- public jackpot list) until an admin approves them, since neither path
-- pulls data from the bookmaker's own verified feed.
ALTER TABLE `Jackpot`
  MODIFY `status` ENUM('NEEDS_REVIEW','OPEN','CLOSED','SETTLED')
  NOT NULL DEFAULT 'OPEN';
