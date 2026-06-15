use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

/// 从 NocoBase 响应中提取记录对象（响应可能是对象或数组）
/// NocoBase 的 update 接口返回 data 数组，create 接口可能返回对象，需要兼容两种格式
pub fn extract_record_object(value: &serde_json::Value) -> Option<&serde_json::Value> {
    if value.is_array() {
        value.as_array().and_then(|arr| arr.first())
    } else if value.is_object() {
        Some(value)
    } else {
        None
    }
}

/// 解析本地数据库时间字符串 'YYYY-MM-DD HH:MM:SS'（本地时间）为 NaiveDateTime
pub fn parse_local_naive(time_str: &str) -> Option<NaiveDateTime> {
    if time_str.is_empty() {
        return None;
    }
    NaiveDateTime::parse_from_str(time_str, "%Y-%m-%d %H:%M:%S").ok()
}

/// 解析 NocoBase 返回的 ISO UTC 时间字符串为 DateTime<Utc>
/// 支持带 Z 或带时区偏移的 RFC3339 格式
pub fn parse_iso_utc(time_str: &str) -> Option<DateTime<Utc>> {
    if time_str.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(time_str)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

/// 把 NocoBase 的 ISO UTC 字符串转换为本地数据库格式 'YYYY-MM-DD HH:MM:SS'（本地时间）
pub fn iso_utc_to_local_db(iso_str: &str) -> Option<String> {
    parse_iso_utc(iso_str).map(|utc_dt| {
        utc_dt.with_timezone(&Local).format("%Y-%m-%d %H:%M:%S").to_string()
    })
}

/// 把本地数据库时间字符串 'YYYY-MM-DD HH:MM:SS'（本地时间）转换为 ISO UTC（用于 NocoBase 增量过滤）
#[allow(dead_code)]
pub fn local_db_to_iso_utc(time_str: &str) -> Option<String> {
    parse_local_naive(time_str).and_then(|naive| {
        Local.from_local_datetime(&naive).single().map(|local_dt| {
            local_dt.with_timezone(&Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        })
    })
}

/// 把任意时间字符串规范化为日期格式 'YYYY-MM-DD'（只提取日期部分）
/// 支持输入：ISO UTC (2026-05-25T08:43:33.000Z)、空格格式 (2026-05-25 14:59:33)、纯日期 (2026-05-25)
pub fn normalize_to_date(time_str: &str) -> Option<String> {
    if time_str.is_empty() {
        return None;
    }
    // 提取前 10 个字符（YYYY-MM-DD）
    if time_str.len() >= 10 {
        Some(time_str[0..10].to_string())
    } else {
        None
    }
}

/// 比较本地时间（本地空格格式）和 NocoBase 时间（ISO UTC 格式），返回云端比本地新多少秒
/// 正数：云端较新；负数：本地较新
pub fn diff_seconds_remote_minus_local(local_str: &str, nocobase_iso_str: &str) -> Option<i64> {
    let local_naive = parse_local_naive(local_str)?;
    let local_dt = Local.from_local_datetime(&local_naive).single()?;
    let local_utc = local_dt.with_timezone(&Utc);
    let remote_utc = parse_iso_utc(nocobase_iso_str)?;
    Some((remote_utc - local_utc).num_seconds())
}

/// NocoBase API 客户端
pub struct NocoBaseClient {
    base_url: String,
    token: String,
    http: Client,
}

impl NocoBaseClient {
    pub fn new(base_url: String, token: String) -> Self {
        let base_url = base_url.trim_end_matches('/').to_string();
        Self {
            base_url,
            token,
            http: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    /// 创建记录
    pub async fn create_record(
        &self,
        collection: &str,
        data: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/{}:create", self.base_url, collection);
        self.post(&url, data).await
    }

    /// 更新记录
    pub async fn update_record(
        &self,
        collection: &str,
        id: i64,
        data: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/{}:update/{}", self.base_url, collection, id);
        self.post(&url, data).await
    }

    /// 查询记录（分页）
    pub async fn list_records(
        &self,
        collection: &str,
        filter: Option<serde_json::Value>,
        page: u32,
        page_size: u32,
    ) -> Result<NocoBaseListResponse, String> {
        // 使用 GET 请求，参数通过 URL 查询字符串传递
        let mut url = format!("{}/api/{}:list?page={}&pageSize={}", self.base_url, collection, page, page_size);
        
        // 如果有 filter，作为 URL 查询参数添加
        if let Some(f) = filter {
            let filter_str = f.to_string();
            // URL 编码 filter
            let encoded_filter = urlencoding::encode(&filter_str);
            url = format!("{}&filter={}", url, encoded_filter);
        }
        
        println!("[DEBUG] NocoBase 请求 - URL: {}", url);
        
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| format!("HTTP 请求失败: {}", e))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        
        println!("[DEBUG] NocoBase 响应 - Status: {}, 响应长度: {} 字符", status, text.len());
        
        if !status.is_success() {
            return Err(format!("HTTP {} {}", status.as_u16(), text));
        }

        // 检查是否为错误响应
        if text.contains("\"errors\"") {
            let error_resp: Result<NocoBaseErrorResponse, _> = serde_json::from_str(&text);
            if let Ok(err) = error_resp {
                if let Some(errors) = err.errors {
                    if !errors.is_empty() {
                        let msg = errors.iter()
                            .filter_map(|e| e.message.as_ref())
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(", ");
                        return Err(format!("NocoBase 错误: {}", msg));
                    }
                }
            }
        }

        // 解析列表响应
        let list_resp: NocoBaseListResponse = serde_json::from_str(&text)
            .map_err(|e| format!("解析列表响应失败: {}, text={}", e, &text[..200.min(text.len())]))?;
        Ok(list_resp)
    }

    /// 删除记录
    #[allow(dead_code)]
    pub async fn delete_record(
        &self,
        collection: &str,
        filter: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/{}:destroy", self.base_url, collection);
        let body = serde_json::json!({ "filter": filter });
        self.post(&url, body).await
    }

    /// 测试连接
    pub async fn test_connection(&self) -> Result<(), String> {
        // 尝试获取任意 collection 的第一页
        let url = format!("{}/api/records:list?page=1&pageSize=1", self.base_url);
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .send()
            .await
            .map_err(|e| format!("HTTP 请求失败: {}", e))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("HTTP {} {}", status.as_u16(), text));
        }

        // 检查是否为错误响应
        if text.contains("\"errors\"") {
            let error_resp: Result<NocoBaseErrorResponse, _> = serde_json::from_str(&text);
            if let Ok(err) = error_resp {
                if let Some(errors) = err.errors {
                    if !errors.is_empty() {
                        let msg = errors.iter()
                            .filter_map(|e| e.message.as_ref())
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(", ");
                        return Err(format!("NocoBase 错误: {}", msg));
                    }
                }
            }
        }

        Ok(())
    }

    async fn post(&self, url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .post(url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP 请求失败: {}", e))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("HTTP {} {}", status.as_u16(), text));
        }

        // 检查是否为错误响应
        if text.contains("\"errors\"") {
            let error_resp: Result<NocoBaseErrorResponse, _> = serde_json::from_str(&text);
            if let Ok(err) = error_resp {
                if let Some(errors) = err.errors {
                    if !errors.is_empty() {
                        let msg = errors.iter()
                            .filter_map(|e| e.message.as_ref())
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(", ");
                        return Err(format!("NocoBase 错误: {}", msg));
                    }
                }
            }
        }

        // 解析响应
        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("解析 JSON 失败: {}, text={}", e, &text[..200.min(text.len())]))?;

        // NocoBase 成功响应包含 data 字段
        json.get("data")
            .cloned()
            .or_else(|| Some(json))
            .ok_or_else(|| "响应中无数据".to_string())
    }
}

/// NocoBase API 通用响应（错误时使用）
#[derive(Deserialize)]
struct NocoBaseErrorResponse {
    errors: Option<Vec<NocoBaseErrorDetail>>,
}

#[derive(Deserialize)]
struct NocoBaseErrorDetail {
    message: Option<String>,
}

/// NocoBase 列表响应
#[derive(Deserialize)]
pub struct NocoBaseListResponse {
    pub data: Vec<serde_json::Value>,
    #[serde(default)]
    pub meta: NocoBaseMeta,
}

#[derive(Deserialize, Default)]
#[allow(dead_code)]
pub struct NocoBaseMeta {
    pub count: u32,
    pub page: u32,
    #[serde(rename = "pageSize")]
    pub page_size: u32,
    #[serde(rename = "totalPage")]
    pub total_page: u32,
}
