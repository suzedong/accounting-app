use std::fs;
use std::io::Write;
use tauri::State;
use serde::{Deserialize, Serialize};

use crate::OcrEngine;

// --- Status Check ---

#[derive(Serialize)]
pub struct OcrStatus {
    pub available: bool,
}

/// 检查 OCR 引擎状态
#[tauri::command]
pub fn check_ocr_status(ocr_engine: State<'_, OcrEngine>) -> Result<OcrStatus, String> {
    let guard = ocr_engine.get().map_err(|e| e.to_string())?;
    Ok(OcrStatus {
        available: guard.is_some(),
    })
}

// --- Model Management ---

#[derive(Serialize, Deserialize, Clone)]
pub struct OcrModel {
    pub id: String,
    pub name: String,
    pub size_mb: f64,
    pub sha256: String,
    pub file_name: String,
    pub download_urls: Vec<String>,
    pub downloaded: bool,
}

fn default_models() -> Vec<OcrModel> {
    vec![
        OcrModel {
            id: "rapidocr-det".to_string(),
            name: "文本检测 (det)".to_string(),
            size_mb: 4.6,
            sha256: "".to_string(),
            file_name: "ch_PP-OCRv4_det_infer.onnx".to_string(),
            download_urls: vec![
                "https://github.com/RapidAI/RapidOCR/raw/main/ocr_models/det_models/ch_PP-OCRv4_det_infer.onnx".to_string(),
            ],
            downloaded: false,
        },
        OcrModel {
            id: "rapidocr-rec".to_string(),
            name: "文本识别 (rec)".to_string(),
            size_mb: 10.5,
            sha256: "".to_string(),
            file_name: "ch_PP-OCRv4_rec_infer.onnx".to_string(),
            download_urls: vec![
                "https://github.com/RapidAI/RapidOCR/raw/main/ocr_models/rec_models/ch_PP-OCRv4_rec_infer.onnx".to_string(),
            ],
            downloaded: false,
        },
        OcrModel {
            id: "rapidocr-cls".to_string(),
            name: "文本分类 (cls)".to_string(),
            size_mb: 1.4,
            sha256: "".to_string(),
            file_name: "ch_ppocr_mobile_v2.0_cls_infer.onnx".to_string(),
            download_urls: vec![
                "https://github.com/RapidAI/RapidOCR/raw/main/ocr_models/cls_models/ch_ppocr_mobile_v2.0_cls_infer.onnx".to_string(),
            ],
            downloaded: false,
        },
    ]
}

/// 获取 OCR 模型列表（含下载状态）
#[tauri::command]
pub async fn get_ocr_models(ocr_engine: State<'_, OcrEngine>) -> Result<Vec<OcrModel>, String> {
    // Get models dir
    let models_dir = find_models_dir();

    let mut models = default_models();

    if let Some(dir) = models_dir {
        for model in &mut models {
            let path = dir.join(&model.file_name);
            model.downloaded = path.exists();
        }
    }

    // Check if engine is loaded
    let guard = ocr_engine.get().map_err(|e| e.to_string())?;
    // If engine is loaded, mark all as downloaded
    if guard.is_some() {
        for model in &mut models {
            model.downloaded = true;
        }
    }

    Ok(models)
}

/// 下载指定 OCR 模型
#[tauri::command]
pub async fn download_ocr_model(model_id: String) -> Result<String, String> {
    let models = default_models();
    let model = models.iter().find(|m| m.id == model_id)
        .ok_or_else(|| format!("未知模型: {}", model_id))?;

    // Get models dir
    let dir = ensure_models_dir()?;
    let dest = dir.join(&model.file_name);

    // Download from first available URL
    let client = reqwest::Client::new();
    let mut last_err = String::new();

    for url in &model.download_urls {
        let response = client.get(url).send().await;
        if let Ok(resp) = response {
            if resp.status().is_success() {
                let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {}", e))?;
                let mut file = fs::File::create(&dest).map_err(|e| format!("创建文件失败: {}", e))?;
                file.write_all(&bytes).map_err(|e| format!("写入文件失败: {}", e))?;
                return Ok(format!("下载完成: {}", model.name));
            }
        } else if let Err(e) = response {
            last_err = e.to_string();
        }
    }

    Err(format!("下载失败: {}", last_err))
}

/// 删除已安装的 OCR 模型
#[tauri::command]
pub fn delete_ocr_model(model_id: String) -> Result<String, String> {
    let models = default_models();
    let model = models.iter().find(|m| m.id == model_id)
        .ok_or_else(|| format!("未知模型: {}", model_id))?;

    let dir = find_models_dir().ok_or("模型目录不存在")?;
    let path = dir.join(&model.file_name);

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除失败: {}", e))?;
        Ok(format!("已删除: {}", model.name))
    } else {
        Ok(format!("未安装: {}", model.name))
    }
}

// --- OCR Recognition ---

/// 执行 OCR 识别
#[tauri::command]
pub async fn ocr_recognize(
    ocr_engine: State<'_, OcrEngine>,
    image_base64: String,
) -> Result<String, String> {
    let guard = ocr_engine.get().map_err(|e| e.to_string())?;
    let engine = guard.as_ref().ok_or_else(|| {
        "OCR 引擎未初始化".to_string()
    })?;

    let image_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &image_base64,
    )
    .map_err(|e| format!("Base64 解码失败: {}", e))?;

    let tmp_dir = std::env::temp_dir();
    let tmp_path = tmp_dir.join(format!("ocr_{}.png", uuid::Uuid::new_v4()));

    fs::write(&tmp_path, &image_bytes)
        .map_err(|e| format!("保存临时图片失败: {}", e))?;

    let result = engine.recognize_from_file(&tmp_path);
    let _ = fs::remove_file(&tmp_path);
    result
}

// --- Helpers ---

fn ensure_models_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::data_local_dir()
        .map(|d| d.join("ai-jizhang/models"))
        .ok_or_else(|| "无法获取应用数据目录".to_string())?;

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    Ok(dir)
}

fn find_models_dir() -> Option<std::path::PathBuf> {
    // Search paths (same as main.rs)
    let candidates: Vec<std::path::PathBuf> = vec![
        std::path::PathBuf::from("./models"),
        std::path::PathBuf::from("src-tauri/models"),
        std::path::PathBuf::from("models"),
    ];

    // App data dir
    if let Some(app_dir) = dirs::data_local_dir() {
        let data_models = app_dir.join("ai-jizhang/models");
        if data_models.exists() {
            return Some(data_models);
        }
    }

    for path in candidates {
        if path.exists() && path.is_dir() {
            return Some(path);
        }
    }
    None
}
