-- Tags each cached news article by sport so /api/news?sport= can filter.
-- Existing rows default to FOOTBALL (the only sport newsAggregator has
-- ever fetched for so far), which is correct for all current data.
ALTER TABLE `NewsArticle`
  ADD COLUMN `sport` ENUM('FOOTBALL','BASKETBALL','HOCKEY','BASEBALL','HANDBALL','VOLLEYBALL','RUGBY','AFL','NFL')
  NOT NULL DEFAULT 'FOOTBALL';

CREATE INDEX `NewsArticle_sport_idx` ON `NewsArticle` (`sport`);
