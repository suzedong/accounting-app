use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

use super::schema;

pub struct Database {
    conn: Mutex<Option<Connection>>,
}

impl Database {
    pub fn new() -> Self {
        Self {
            conn: Mutex::new(None),
        }
    }

    pub fn init(&self) -> Result<(), String> {
        let mut guard = self.conn.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }

        let db_path = Self::db_path()?;
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        // Enable WAL mode for better concurrent write handling
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;

        // Initialize schema
        schema::init(&conn).map_err(|e| e.to_string())?;

        *guard = Some(conn);
        Ok(())
    }

    pub fn get_conn(&self) -> Result<impl std::ops::Deref<Target = Connection> + '_, String> {
        let guard = self.conn.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_ref().ok_or("Database not initialized")?;
        // Return a mapped guard that dereferences to Connection
        Ok(std::sync::MutexGuard::map(guard, |opt| {
            opt.as_ref().unwrap()
        }))
    }

    fn db_path() -> Result<PathBuf, String> {
        let dir = dirs::config_dir()
            .ok_or("Cannot determine config directory")?
            .join("accounting-app");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join("app_data.db"))
    }
}
