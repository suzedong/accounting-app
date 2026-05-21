use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use super::schema;

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new() -> Self {
        let db_path = Self::db_path().expect("Failed to determine db path");
        let conn = Connection::open(&db_path).expect("Failed to open database");

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("Failed to set WAL mode");

        schema::init(&conn).expect("Failed to initialize schema");

        Self {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    pub fn get_conn(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }

    fn db_path() -> Result<PathBuf, String> {
        // 开发模式：数据库放在项目目录 database/ 下，方便查找和备份
        // 发布模式：使用系统标准 Application Support 目录
        if cfg!(debug_assertions) {
            // 开发时：项目根目录下的 database/app_data.db
            // CARGO_MANIFEST_DIR 指向 src-tauri/，parent() 即项目根目录
            let project_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or("Cannot determine project directory")?
                .to_path_buf();
            let db_dir = project_dir.join("database");
            std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
            Ok(db_dir.join("app_data.db"))
        } else {
            // 发布时：~/Library/Application Support/accounting-app/
            let dir = dirs::config_dir()
                .ok_or("Cannot determine config directory")?
                .join("accounting-app");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            Ok(dir.join("app_data.db"))
        }
    }
}
