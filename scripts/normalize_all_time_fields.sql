-- ============================================================================
-- 本地数据库时间字段规范化脚本（完整版）
-- ============================================================================
-- 用途：将所有时间字段统一为标准格式
--   - datetime/local_updated_at/created_at/updated_at → 'YYYY-MM-DD HH:MM:SS' 本地时间
--   - paid_date → 'YYYY-MM-DD' 纯日期
-- 适用：开发阶段修复历史数据，生产环境新数据已按正确格式写入
--
-- 使用方法：
--   macOS/Linux:
--     sqlite3 ~/Library/Application\ Support/accounting-app/app_data.db < normalize_all_time_fields.sql
--   Windows:
--     sqlite3 "%APPDATA%\accounting-app\app_data.db" < normalize_all_time_fields.sql
--   开发环境:
--     sqlite3 database/app_data.db < normalize_all_time_fields.sql
--
-- 注意事项：
--   1. 运行前请备份数据库
--   2. 转换规则：
--      - ISO UTC (2026-06-14T09:30:00.000Z) → 本地时间空格格式
--      - ISO 无 Z (2026-06-14T17:30:00) → 本地时间空格格式（假设是本地时间）
--      - 空格格式 → 保持不变
-- ============================================================================

-- ============================================================================
-- 1. records 表
-- ============================================================================
-- datetime 字段：ISO UTC -> 本地时间空格格式
UPDATE records
SET datetime = datetime(datetime, 'localtime')
WHERE datetime LIKE '%T%Z';

UPDATE records
SET datetime = REPLACE(SUBSTR(datetime, 1, 19), 'T', ' ')
WHERE datetime LIKE '%T%' AND datetime NOT LIKE '%Z';

-- local_updated_at 字段：ISO UTC -> 本地时间空格格式
UPDATE records
SET local_updated_at = datetime(local_updated_at, 'localtime')
WHERE local_updated_at LIKE '%T%Z';

UPDATE records
SET local_updated_at = REPLACE(SUBSTR(local_updated_at, 1, 19), 'T', ' ')
WHERE local_updated_at LIKE '%T%' AND local_updated_at NOT LIKE '%Z';

-- created_at 字段：ISO UTC -> 本地时间空格格式
UPDATE records
SET created_at = datetime(created_at, 'localtime')
WHERE created_at LIKE '%T%Z';

UPDATE records
SET created_at = REPLACE(SUBSTR(created_at, 1, 19), 'T', ' ')
WHERE created_at LIKE '%T%' AND created_at NOT LIKE '%Z';

-- ============================================================================
-- 2. business_trip 表
-- ============================================================================
-- paid_date 字段：提取前 10 个字符（YYYY-MM-DD）
UPDATE business_trip
SET paid_date = SUBSTR(paid_date, 1, 10)
WHERE paid_date IS NOT NULL AND paid_date != '';

-- created_at 字段：ISO UTC -> 本地时间空格格式
UPDATE business_trip
SET created_at = datetime(created_at, 'localtime')
WHERE created_at LIKE '%T%Z';

UPDATE business_trip
SET created_at = REPLACE(SUBSTR(created_at, 1, 19), 'T', ' ')
WHERE created_at LIKE '%T%' AND created_at NOT LIKE '%Z';

-- ============================================================================
-- 3. learning_data 表
-- ============================================================================
-- created_at 字段：ISO UTC -> 本地时间空格格式
UPDATE learning_data
SET created_at = datetime(created_at, 'localtime')
WHERE created_at LIKE '%T%Z';

UPDATE learning_data
SET created_at = REPLACE(SUBSTR(created_at, 1, 19), 'T', ' ')
WHERE created_at LIKE '%T%' AND created_at NOT LIKE '%Z';

-- ============================================================================
-- 4. system_prompts 表
-- ============================================================================
-- updated_at 字段：ISO UTC -> 本地时间空格格式
UPDATE system_prompts
SET updated_at = datetime(updated_at, 'localtime')
WHERE updated_at LIKE '%T%Z';

UPDATE system_prompts
SET updated_at = REPLACE(SUBSTR(updated_at, 1, 19), 'T', ' ')
WHERE updated_at LIKE '%T%' AND updated_at NOT LIKE '%Z';

-- ============================================================================
-- 5. chat_history 表
-- ============================================================================
-- created_at 字段：ISO UTC -> 本地时间空格格式
UPDATE chat_history
SET created_at = datetime(created_at, 'localtime')
WHERE created_at LIKE '%T%Z';

UPDATE chat_history
SET created_at = REPLACE(SUBSTR(created_at, 1, 19), 'T', ' ')
WHERE created_at LIKE '%T%' AND created_at NOT LIKE '%Z';

-- ============================================================================
-- 6. sync_log 表
-- ============================================================================
-- created_at 字段：ISO UTC -> 本地时间空格格式
UPDATE sync_log
SET created_at = datetime(created_at, 'localtime')
WHERE created_at LIKE '%T%Z';

UPDATE sync_log
SET created_at = REPLACE(SUBSTR(created_at, 1, 19), 'T', ' ')
WHERE created_at LIKE '%T%' AND created_at NOT LIKE '%Z';

-- ============================================================================
-- 验证结果
-- ============================================================================
-- 1. records 表格式统计
SELECT 'records.datetime' as field,
       CASE
           WHEN datetime LIKE '%T%' THEN 'ISO格式（异常）'
           WHEN datetime LIKE '% %' THEN '空格格式（正确）'
           ELSE '其他（异常）'
       END as format_type,
       COUNT(*) as count
FROM records
GROUP BY format_type;

SELECT 'records.local_updated_at' as field,
       CASE
           WHEN local_updated_at LIKE '%T%' THEN 'ISO格式（异常）'
           WHEN local_updated_at LIKE '% %' THEN '空格格式（正确）'
           ELSE '其他（异常）'
       END as format_type,
       COUNT(*) as count
FROM records
GROUP BY format_type;

-- 2. business_trip 表格式统计
SELECT 'business_trip.paid_date' as field,
       CASE
           WHEN paid_date LIKE '%T%' THEN 'ISO格式（异常）'
           WHEN paid_date LIKE '% %' THEN '空格格式（异常）'
           WHEN length(paid_date) = 10 THEN '纯日期格式（正确）'
           ELSE '其他（异常）'
       END as format_type,
       COUNT(*) as count
FROM business_trip
WHERE paid_date IS NOT NULL AND paid_date != ''
GROUP BY format_type;

-- 3. 其他表格式统计
SELECT 'business_trip.created_at' as field,
       CASE
           WHEN created_at LIKE '%T%' THEN 'ISO格式（异常）'
           WHEN created_at LIKE '% %' THEN '空格格式（正确）'
           ELSE '其他（异常）'
       END as format_type,
       COUNT(*) as count
FROM business_trip
GROUP BY format_type;

SELECT 'learning_data.created_at' as field,
       CASE
           WHEN created_at LIKE '%T%' THEN 'ISO格式（异常）'
           WHEN created_at LIKE '% %' THEN '空格格式（正确）'
           ELSE '其他（异常）'
       END as format_type,
       COUNT(*) as count
FROM learning_data
GROUP BY format_type;

SELECT 'system_prompts.updated_at' as field,
       CASE
           WHEN updated_at LIKE '%T%' THEN 'ISO格式（异常）'
           WHEN updated_at LIKE '% %' THEN '空格格式（正确）'
           ELSE '其他（异常）'
       END as format_type,
       COUNT(*) as count
FROM system_prompts
GROUP BY format_type;

SELECT 'chat_history.created_at' as field,
       CASE
           WHEN created_at LIKE '%T%' THEN 'ISO格式（异常）'
           WHEN created_at LIKE '% %' THEN '空格格式（正确）'
           ELSE '其他（异常）'
       END as format_type,
       COUNT(*) as count
FROM chat_history
GROUP BY format_type;

SELECT 'sync_log.created_at' as field,
       CASE
           WHEN created_at LIKE '%T%' THEN 'ISO格式（异常）'
           WHEN created_at LIKE '% %' THEN '空格格式（正确）'
           ELSE '其他（异常）'
       END as format_type,
       COUNT(*) as count
FROM sync_log
GROUP BY format_type;