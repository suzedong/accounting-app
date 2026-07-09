use std::path::PathBuf;
use std::sync::Arc;

use libsql::{Builder, Database as LibsqlDatabase};

use super::schema;

/// Database wrapper around libsql::Database.
///
/// Supports two modes:
/// - Pure local (default): libsql opens a local SQLite file. No sync.
/// - Turso Embedded Replica: libsql opens a local file that syncs bidirectionally
///   with a remote Turso database when `sync()` is called.
///
/// Note: `libsql::Connection` is `Clone + Send + Sync`, so we hand out fresh
/// connection handles from a single underlying Database without wrapping in Mutex.
pub struct Database {
    inner: Arc<LibsqlDatabase>,
    /// True when opened as a Turso Embedded Replica (via `new_with_turso`);
    /// false for pure-local File mode. libsql refuses `sync()` in File mode,
    /// so we short-circuit with a friendly message.
    is_replica: bool,
}

impl Database {
    /// Open a pure-local libsql database.
    pub async fn new() -> Result<Self, String> {
        let db_path = Self::db_path()?;
        eprintln!("[DB] Opening local database: {}", db_path.display());

        let db = Builder::new_local(&db_path)
            .build()
            .await
            .map_err(|e| format!("Failed to open local database: {}", e))?;

        Self::init_and_wrap(db, false).await
    }

    /// Open a libsql database as a Turso Embedded Replica.
    ///
    /// Uses a **separate** local file (`app_data_sync.db`) instead of the
    /// pure-local `app_data.db`, because libsql refuses to open Embedded Replica
    /// on a file that was previously created in File mode (no metadata sidecar).
    ///
    /// **不做启动同步**（本地优先设计）：直接返回已打开的 replica，业务代码立刻用本地
    /// SQLite 副本工作。同步由前端在主界面挂载后延迟触发（走 `sync_turso` command）。
    /// 首次启用 Turso 时本地 replica 是空的——schema.rs 的 `CREATE TABLE IF NOT EXISTS`
    /// 会正确建表，用户点击"立即同步"或延迟同步触发时才从云端拉数据。
    pub async fn new_with_turso(url: String, auth_token: String) -> Result<Self, String> {
        let db_path = Self::replica_db_path()?;
        eprintln!(
            "[DB] Opening embedded replica: local={} remote={}",
            db_path.display(),
            url
        );

        let db = Builder::new_remote_replica(db_path, url, auth_token)
            .build()
            .await
            .map_err(|e| format!("Failed to open embedded replica: {}", e))?;

        Self::init_and_wrap(db, true).await
    }

    async fn init_and_wrap(db: LibsqlDatabase, is_replica: bool) -> Result<Self, String> {
        let conn = db
            .connect()
            .map_err(|e| format!("Failed to connect to database: {}", e))?;

        // busy_timeout=5000: 遇到 "database is locked" 时最多等待 5s 而不是立刻失败
        //   这在 Embedded Replica 首次同步刚结束、schema init 尚在写、多个前端页面并发
        //   查询时特别关键；否则会出现 "SQLite failure: database is locked" 一闪而过。
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
        )
        .await
        .map_err(|e| format!("Failed to set PRAGMA: {}", e))?;

        schema::init(&conn)
            .await
            .map_err(|e| format!("Failed to initialize schema: {}", e))?;

        Ok(Self {
            inner: Arc::new(db),
            is_replica,
        })
    }

    /// Obtain a fresh connection with `busy_timeout` applied.
    ///
    /// libsql 连接是廉价句柄且 `Clone + Send + Sync`，无需 Mutex。
    /// `PRAGMA busy_timeout` 是 **per-connection** 的，每次新连接单独设置。
    ///
    /// **重试机制**：Embedded Replica 首次同步刚结束、schema init 尚在写、Turso 后台
    /// sync worker 也在跑时，`inner.connect()` 可能直接返回 "database is locked"
    /// （不走 busy_timeout，因为还没进入 SQL 层）。这里最多重试 15 次 × 200ms = 3s。
    pub async fn get_conn(&self) -> Result<libsql::Connection, String> {
        let mut attempts = 0u32;
        loop {
            match self.inner.connect() {
                Ok(conn) => {
                    // 遇到锁最多等 5 秒后重试。libsql 里 PRAGMA busy_timeout=N 返回一行，
                    // 必须用 query 消费掉 rows，用 execute 会报 "Execute returned rows"
                    {
                        let mut rows = conn
                            .query("PRAGMA busy_timeout=5000", ())
                            .await
                            .map_err(|e| format!("Failed to set busy_timeout: {}", e))?;
                        let _ = rows.next().await;
                    }
                    return Ok(conn);
                }
                Err(e) => {
                    let msg = e.to_string();
                    if attempts < 15 && msg.contains("locked") {
                        attempts += 1;
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                        continue;
                    }
                    return Err(format!("Failed to get connection: {}", e));
                }
            }
        }
    }

    /// Whether this database was opened as a Turso Embedded Replica.
    #[allow(dead_code)]
    pub fn is_replica(&self) -> bool {
        self.is_replica
    }

    /// Trigger bidirectional sync with the remote Turso database.
    /// In File mode returns a friendly error asking the user to enable + restart.
    pub async fn sync(&self) -> Result<(), String> {
        if !self.is_replica {
            return Err(
                "当前应用运行在纯本地模式（未启用 Turso 同步或配置未生效）。请在 设置 → 数据同步 中启用同步开关，填好 URL/Token 后重启应用。"
                    .to_string(),
            );
        }
        self.inner
            .sync()
            .await
            .map(|_| ())
            .map_err(|e| format!("Sync failed: {}", e))
    }

    fn db_path() -> Result<PathBuf, String> {
        if cfg!(debug_assertions) {
            let project_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or("Cannot determine project directory")?
                .to_path_buf();
            let db_dir = project_dir.join("database");
            std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
            Ok(db_dir.join("app_data.db"))
        } else {
            let dir = dirs::config_dir()
                .ok_or("Cannot determine config directory")?
                .join("accounting-app");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            Ok(dir.join("app_data.db"))
        }
    }

    /// Path for Embedded Replica; kept separate from `db_path()` so that a
    /// previously File-mode-opened `app_data.db` doesn't block replica open.
    fn replica_db_path() -> Result<PathBuf, String> {
        if cfg!(debug_assertions) {
            let project_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or("Cannot determine project directory")?
                .to_path_buf();
            let db_dir = project_dir.join("database");
            std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
            Ok(db_dir.join("app_data_sync.db"))
        } else {
            let dir = dirs::config_dir()
                .ok_or("Cannot determine config directory")?
                .join("accounting-app");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            Ok(dir.join("app_data_sync.db"))
        }
    }
}
