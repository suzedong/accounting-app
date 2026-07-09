use libsql::params;
use serde::Serialize;

use super::connection::Database;

#[derive(Serialize)]
pub struct PromptRow {
    pub name: String,
    pub content: String,
    pub updated_at: String,
}

pub async fn get_prompt(state: &Database, name: &str) -> Result<Option<PromptRow>, String> {
    let conn = state.get_conn().await?;
    let mut rows = conn
        .query(
            "SELECT name, content, updated_at FROM system_prompts WHERE name = ?",
            params![name],
        )
        .await
        .map_err(|e| e.to_string())?;

    match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => Ok(Some(PromptRow {
            name: row.get::<String>(0).map_err(|e| e.to_string())?,
            content: row.get::<String>(1).map_err(|e| e.to_string())?,
            updated_at: row.get::<Option<String>>(2).map_err(|e| e.to_string())?.unwrap_or_default(),
        })),
        None => Ok(None),
    }
}

pub async fn update_prompt(state: &Database, name: &str, content: &str) -> Result<(), String> {
    let conn = state.get_conn().await?;
    let now = chrono::Local::now()
        .naive_local()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    conn.execute(
        "INSERT INTO system_prompts (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
        params![name, content, now],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Update a single key-value pair within the preferences markdown document.
/// Finds lines matching `- key：value` and replaces or appends.
pub async fn update_preference_in_doc(
    state: &Database,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let current = get_prompt(state, "preferences")
        .await?
        .map(|p| p.content)
        .unwrap_or_default();

    // Find and replace existing line, or append
    let lines: Vec<&str> = current.split('\n').collect();
    let mut found = false;
    let new_lines: Vec<String> = lines
        .iter()
        .map(|line| {
            // Match "- key：value" or "- key: value" (both full-width and half-width colon)
            if let Some(pos) = line.find(['：', ':']) {
                let prefix = line[..pos].trim().trim_start_matches('-').trim();
                if prefix == key {
                    found = true;
                    return format!("- {}：{}", key, value);
                }
            }
            line.to_string()
        })
        .collect();

    let new_content = if found {
        new_lines.join("\n")
    } else {
        format!("{}\n- {}：{}", current, key, value)
    };

    update_prompt(state, "preferences", &new_content).await
}
