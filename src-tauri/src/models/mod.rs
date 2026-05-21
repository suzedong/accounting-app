// Shared model structs
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct AiService {
    pub id: String,
    pub name: String,
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    pub active: bool,
}
