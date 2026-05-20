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
        let dir = dirs::config_dir()
            .ok_or("Cannot determine config directory")?
            .join("accounting-app");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join("app_data.db"))
    }
}
