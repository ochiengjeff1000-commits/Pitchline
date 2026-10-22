-- Adds HALFTIME as a distinct FixtureStatus value (previously collapsed into LIVE).
-- MySQL enums are stored as an inline column type, so this requires MODIFY COLUMN
-- rather than a separate ALTER TYPE statement.
ALTER TABLE `Fixture`
  MODIFY `status` ENUM('SCHEDULED','LIVE','HALFTIME','FINISHED','POSTPONED','CANCELLED')
  NOT NULL DEFAULT 'SCHEDULED';
