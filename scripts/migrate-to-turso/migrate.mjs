#!/usr/bin/env node
/**
 * ============================================================================
 * accounting-app · 本地 SQLite → Turso 迁移脚本
 * ============================================================================
 * 用途：把 macOS / Windows 上现有的 accounting.db 全量迁到 Turso（libSQL）云端库。
 *      迁移过程中会顺便完成 schema 清洗（剔除 NocoBase 遗留列）。
 *
 * 前置准备：
 *   1. 已在 turso.tech 注册账号；
 *   2. 已通过 CLI 创建目标 database：
 *        turso db create accounting-app
 *   3. 拿到 URL 与 auth token：
 *        turso db show accounting-app --url
 *        turso db tokens create accounting-app
 *   4. 已安装依赖：
 *        cd scripts/migrate-to-turso && npm install
 *
 * 常用命令：
 *   # 只读预演（不写 Turso）
 *   node scripts/migrate-to-turso/migrate.mjs \
 *     --source "~/Library/Application Support/com.accounting.app/data/accounting.db" \
 *     --url libsql://xxx.turso.io \
 *     --token eyJhbGciOi... \
 *     --dry-run
 *
 *   # 正式迁移（首次；已有相同 uuid 的行会被跳过，安全）
 *   node scripts/migrate-to-turso/migrate.mjs --source ... --url ... --token ...
 *
 *   # 迁移前先清空 Turso 上已有表（--drop 明示才会执行 DROP）
 *   node scripts/migrate-to-turso/migrate.mjs --source ... --url ... --token ... --drop
 *
 *   # 迁移后自动跑行数 + 抽样验证
 *   node scripts/migrate-to-turso/migrate.mjs --source ... --url ... --token ... --verify
 *
 * 迁移策略（详见 schema.sql）：
 *   - records / business_trip / learning_data：剔除 5 列（synced / retry_count /
 *     last_error / nocobase_id / nocobase_updated_at），其余原样。
 *   - system_prompts / chat_history：原样迁。
 *   - app_config：只迁业务 key（业务列表见 BUSINESS_CONFIG_KEYS）；
 *     nocobase_* / turso_* / *_token 这类端点信息不迁。
 *   - sync_log：跳过（NocoBase 遗物，云端无意义）。
 *
 * 数据安全：
 *   - 采用 INSERT OR IGNORE 按 uuid 幂等写入，多跑不会重复。
 *   - `--drop` 会先删表再重建，会丢已有 Turso 数据；不加则只 CREATE IF NOT EXISTS。
 *   - `--dry-run` 完全只读，任何时候都可以先跑一次预演。
 *
 * 支持平台：macOS / Windows / Linux（Node 18+）。
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI 参数解析
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    source: null,
    url: null,
    token: null,
    dryRun: false,
    drop: false,
    verify: false,
    batchSize: 500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--source': opts.source = next(); break;
      case '--url': opts.url = next(); break;
      case '--token': opts.token = next(); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--drop': opts.drop = true; break;
      case '--verify': opts.verify = true; break;
      case '--batch-size': opts.batchSize = parseInt(next(), 10) || 500; break;
      case '-h': case '--help':
        printUsage(); process.exit(0);
      default:
        if (a.startsWith('--')) {
          console.error(`Unknown option: ${a}`);
          printUsage();
          process.exit(1);
        }
    }
  }
  return opts;
}

function printUsage() {
  console.log(`Usage:
  node migrate.mjs --source <local.db> --url <libsql-url> --token <token> [options]

Options:
  --source <path>       本地 SQLite 数据库文件路径（必填）
  --url <libsql-url>    Turso 数据库 URL（libsql://xxx.turso.io，必填）
  --token <jwt>         Turso auth token（除非 --dry-run，否则必填）
  --dry-run             只读预演：只连本地库统计并打印，不写 Turso
  --drop                写 Turso 前先 DROP TABLE（会丢云端已有数据，慎用）
  --verify              迁移完成后跑行数 + 抽样对比校验
  --batch-size <n>      批量插入大小（默认 500）
  -h, --help            打印帮助
`);
}

// ---------------------------------------------------------------------------
// 常量：要迁移的业务表 + app_config 中允许迁移的 key
// ---------------------------------------------------------------------------

/** app_config 中要迁到云端的业务 key；nocobase_* / turso_* / *_token 都不迁 */
const BUSINESS_CONFIG_KEYS = new Set([
  'budget_monthly',
  'ai_services',
  'active_ai_service',
  'ocr_enabled',
  'force_confirm_corrections',
  'last_confirmed_ttl_minutes',
]);

/**
 * 表迁移计划：
 *   name            表名（两端一致）
 *   sourceCols      从本地读的列（顺序即插入顺序）
 *   targetCols      写到 Turso 的列（通常与 sourceCols 相同）
 *   uniqueBy        用于 INSERT OR IGNORE 的唯一列（表已有 UNIQUE 约束）
 *   filter          可选：本地行过滤器（(row) => bool）
 *   transform       可选：行转换器（(row) => row），比如 app_config 白名单化
 */
const MIGRATION_PLAN = [
  {
    name: 'records',
    sourceCols: ['id', 'uuid', 'datetime', 'type', 'category', 'amount', 'account', 'note', 'payment_method', 'local_updated_at', 'created_at'],
    uniqueBy: 'uuid',
  },
  {
    name: 'business_trip',
    sourceCols: ['id', 'uuid', 'trip_id', 'start_date', 'end_date', 'days', 'trip_allowance', 'transport_allowance', 'total', 'status', 'paid_trip_allowance', 'paid_transport_allowance', 'paid_date', 'notes', 'local_updated_at', 'created_at'],
    uniqueBy: 'uuid',
  },
  {
    name: 'learning_data',
    sourceCols: ['id', 'uuid', 'type', 'key', 'value', 'count', 'local_updated_at', 'created_at'],
    uniqueBy: 'uuid',
  },
  {
    name: 'system_prompts',
    sourceCols: ['name', 'content', 'updated_at'],
    uniqueBy: 'name',
  },
  {
    name: 'chat_history',
    sourceCols: ['id', 'uuid', 'session_id', 'role', 'content', 'data', 'created_at'],
    uniqueBy: 'uuid',
  },
  {
    name: 'app_config',
    sourceCols: ['key', 'value'],
    uniqueBy: 'key',
    filter: (row) => BUSINESS_CONFIG_KEYS.has(row.key),
  },
];

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.source) {
    console.error('Error: --source is required');
    printUsage();
    process.exit(1);
  }
  if (!opts.dryRun && (!opts.url || !opts.token)) {
    console.error('Error: --url and --token are required (unless --dry-run)');
    printUsage();
    process.exit(1);
  }

  // 展开 ~
  const source = opts.source.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '');

  console.log('='.repeat(70));
  console.log('accounting-app · Turso 迁移');
  console.log('='.repeat(70));
  console.log(`Source (local SQLite): ${source}`);
  console.log(`Target (Turso):        ${opts.url || '(dry-run, skipped)'}`);
  console.log(`Mode:                  ${opts.dryRun ? 'DRY-RUN (read only)' : opts.drop ? 'DROP + IMPORT' : 'INCREMENTAL (INSERT OR IGNORE)'}`);
  console.log('');

  // 连本地库（只读）
  let src;
  try {
    src = new Database(source, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error(`Failed to open local db: ${e.message}`);
    process.exit(2);
  }

  // 打印本地行数
  console.log('--- 本地行数快照 ---');
  const localCounts = {};
  for (const tbl of MIGRATION_PLAN) {
    try {
      const row = src.prepare(`SELECT COUNT(*) AS c FROM ${tbl.name}`).get();
      const total = row?.c ?? 0;
      let matched = total;
      if (tbl.filter) {
        matched = src.prepare(`SELECT ${tbl.sourceCols.join(', ')} FROM ${tbl.name}`)
          .all()
          .filter(tbl.filter).length;
      }
      localCounts[tbl.name] = { total, matched };
      console.log(`  ${tbl.name.padEnd(20)} 本地共 ${String(total).padStart(6)} 行` + (tbl.filter ? `，将迁移 ${matched} 行` : ''));
    } catch (e) {
      localCounts[tbl.name] = { total: 0, matched: 0, error: e.message };
      console.log(`  ${tbl.name.padEnd(20)} SKIP（本地无此表或读取失败：${e.message}）`);
    }
  }
  console.log('');

  if (opts.dryRun) {
    console.log('DRY-RUN 完成：仅统计不写入 Turso。');
    src.close();
    return;
  }

  // 连 Turso
  const dst = createClient({ url: opts.url, authToken: opts.token });

  // 建表 / 可选 DROP
  console.log('--- 准备 Turso schema ---');
  if (opts.drop) {
    console.log('  --drop 已指定，DROP 所有目标表...');
    for (const tbl of MIGRATION_PLAN) {
      await dst.execute(`DROP TABLE IF EXISTS ${tbl.name}`);
      console.log(`  DROP ${tbl.name}`);
    }
  }

  const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  // libsql 客户端只支持单条 execute；这里手动按语句分割
  // 先剥掉行首/整行注释（-- ...），再按 ; 分割，避免"注释开头的 CREATE 语句"被整段过滤掉
  const stripped = schemaSql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  const stmts = stripped
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of stmts) {
    await dst.execute(stmt);
  }
  console.log(`  ${stmts.length} 条 DDL 已应用`);
  console.log('');

  // 逐表迁移
  console.log('--- 数据迁移 ---');
  const migrationStart = Date.now();
  const insertedCounts = {};

  for (const tbl of MIGRATION_PLAN) {
    if (!localCounts[tbl.name] || localCounts[tbl.name].total === 0) {
      insertedCounts[tbl.name] = 0;
      console.log(`  ${tbl.name.padEnd(20)} 跳过（本地无数据）`);
      continue;
    }

    const rows = src.prepare(`SELECT ${tbl.sourceCols.join(', ')} FROM ${tbl.name}`)
      .all()
      .filter((r) => (tbl.filter ? tbl.filter(r) : true))
      .map((r) => (tbl.transform ? tbl.transform(r) : r));

    if (rows.length === 0) {
      insertedCounts[tbl.name] = 0;
      console.log(`  ${tbl.name.padEnd(20)} 跳过（过滤后 0 行）`);
      continue;
    }

    const placeholders = tbl.sourceCols.map(() => '?').join(', ');
    // 用 INSERT OR IGNORE 幂等：uuid/key/name 冲突时跳过
    const insertSql = `INSERT OR IGNORE INTO ${tbl.name} (${tbl.sourceCols.join(', ')}) VALUES (${placeholders})`;

    let inserted = 0;
    const t0 = Date.now();
    // 按 batch 拆分（libsql 批量事务）
    for (let i = 0; i < rows.length; i += opts.batchSize) {
      const chunk = rows.slice(i, i + opts.batchSize);
      const batch = chunk.map((r) => ({
        sql: insertSql,
        args: tbl.sourceCols.map((c) => (r[c] === undefined ? null : r[c])),
      }));
      const res = await dst.batch(batch, 'write');
      // 累加实际插入数（rowsAffected）
      for (const r of res) inserted += r.rowsAffected ?? 0;
    }
    insertedCounts[tbl.name] = inserted;
    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    const skipped = rows.length - inserted;
    console.log(`  ${tbl.name.padEnd(20)} 读 ${String(rows.length).padStart(6)} 行 → 写入 ${String(inserted).padStart(6)}，跳过 ${skipped}（uuid 已存在）  ${dt}s`);
  }
  console.log('');
  console.log(`总耗时: ${((Date.now() - migrationStart) / 1000).toFixed(2)}s`);

  // 校验
  if (opts.verify) {
    console.log('');
    console.log('--- 校验 ---');
    let allOk = true;
    for (const tbl of MIGRATION_PLAN) {
      const local = localCounts[tbl.name]?.matched ?? 0;
      const cloudRow = await dst.execute(`SELECT COUNT(*) AS c FROM ${tbl.name}`);
      const cloud = Number(cloudRow.rows[0]?.c ?? 0);
      const match = cloud >= local ? '✓' : '✗';
      if (cloud < local) allOk = false;
      console.log(`  ${match} ${tbl.name.padEnd(20)} 本地(待迁) ${local}  云端 ${cloud}`);

      // 对 records/business_trip 抽样最近 3 条
      if (['records', 'business_trip'].includes(tbl.name) && local > 0) {
        const localSample = src.prepare(
          `SELECT uuid, ${tbl.name === 'records' ? 'amount, note, datetime' : 'trip_id, total, start_date'} FROM ${tbl.name} ORDER BY id DESC LIMIT 3`
        ).all();
        const cloudSampleRes = await dst.execute(
          `SELECT uuid, ${tbl.name === 'records' ? 'amount, note, datetime' : 'trip_id, total, start_date'} FROM ${tbl.name} ORDER BY id DESC LIMIT 3`
        );
        const cloudSample = cloudSampleRes.rows;
        console.log(`    最近 3 条抽样:`);
        for (let i = 0; i < Math.max(localSample.length, cloudSample.length); i++) {
          console.log(`      L${i + 1}: ${JSON.stringify(localSample[i] || null)}`);
          console.log(`      C${i + 1}: ${JSON.stringify(cloudSample[i] || null)}`);
        }
      }
    }
    console.log('');
    console.log(allOk ? '✓ 全部表云端行数不少于本地待迁行数' : '✗ 存在云端行数少于本地待迁的情况，请检查');
  }

  src.close();
  console.log('');
  console.log('完成。');
}

main().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});
