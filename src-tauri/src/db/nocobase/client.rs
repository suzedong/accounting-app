use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

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
