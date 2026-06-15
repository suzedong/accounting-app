-- 修复 local_updated_at 字段：将 UTC 时间转换为本地时间
-- 问题：某些记录的 local_updated_at 存储的是 UTC 时间，应该是本地时间（UTC+8）
-- 解决：将这些时间加上 8 小时

-- 备份数据
CREATE TABLE IF NOT EXISTS records_backup_20260615 AS SELECT * FROM records;

-- 修复 local_updated_at：将 UTC 时间转换为本地时间（+8 小时）
UPDATE records
SET local_updated_at = datetime(
    substr(local_updated_at, 1, 10) || ' ' ||
    substr(local_updated_at, 12, 8),
    '+8 hours'
)
WHERE synced = 1
  AND nocobase_updated_at IS NOT NULL
  AND substr(local_updated_at, 12, 2) = substr(nocobase_updated_at, 12, 2);

-- 验证修复结果
SELECT
    uuid,
    datetime,
    local_updated_at,
    nocobase_updated_at,
    synced
FROM records
WHERE synced = 1
  AND nocobase_updated_at IS NOT NULL
ORDER BY id DESC
LIMIT 5;