use serde::Serialize;

use super::connection::Database;

#[derive(Serialize)]
pub struct PromptRow {
    pub name: String,
    pub content: String,
    pub updated_at: String,
}

pub fn get_prompt(state: &Database, name: &str) -> Result<Option<PromptRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare("SELECT name, content, updated_at FROM system_prompts WHERE name = ?")
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row([name], |row| {
        Ok(PromptRow {
            name: row.get(0)?,
            content: row.get(1)?,
            updated_at: row.get(2)?,
        })
    });

    match result {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn update_prompt(state: &Database, name: &str, content: &str) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute(
        "INSERT INTO system_prompts (name, content, updated_at) VALUES (?, ?, datetime('now', 'localtime')) ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = datetime('now', 'localtime')",
        [name, content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Update a single key-value pair within the preferences markdown document.
/// Finds lines matching `- key：value` and replaces or appends.
pub fn update_preference_in_doc(state: &Database, key: &str, value: &str) -> Result<(), String> {
    let current = get_prompt(state, "preferences")?
        .map(|p| p.content)
        .unwrap_or_default();

    // Find and replace existing line, or append
    let lines: Vec<&str> = current.split('\n').collect();
    let mut found = false;
    let new_lines: Vec<String> = lines.iter().map(|line| {
        // Match "- key：value" or "- key: value" (both full-width and half-width colon)
        if let Some(pos) = line.find(['：', ':']) {
            let prefix = line[..pos].trim().trim_start_matches('-').trim();
            if prefix == key {
                found = true;
                return format!("- {}：{}", key, value);
            }
        }
        line.to_string()
    }).collect();

    let new_content = if found {
        new_lines.join("\n")
    } else {
        format!("{}\n- {}：{}", current, key, value)
    };

    update_prompt(state, "preferences", &new_content)
}
