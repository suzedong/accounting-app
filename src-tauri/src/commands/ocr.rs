use std::fs;
use tauri::State;

use crate::OcrEngine;

/// 加载 OCR 模型
#[tauri::command]
pub async fn load_ocr_models(
    ocr_engine: State<'_, OcrEngine>,
    models_dir: String,
) -> Result<String, String> {
    let dir = std::path::PathBuf::from(&models_dir);
    if !dir.exists() {
        return Err(format!("目录不存在: {}", dir.display()));
    }

    ocr_engine.load(dir)?;
    Ok("OCR 引擎加载成功".to_string())
}

/// 执行 OCR 识别
#[tauri::command]
pub async fn ocr_recognize(
    ocr_engine: State<'_, OcrEngine>,
    image_base64: String,
) -> Result<String, String> {
    // 获取 OCR 引擎
    let guard = ocr_engine.get().map_err(|e| e.to_string())?;
    let engine_ref = guard;

    let engine = engine_ref.as_ref().ok_or_else(|| {
        "OCR 引擎未初始化，请先调用 load_ocr_models".to_string()
    })?;

    // 解码 base64 图片
    let image_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &image_base64,
    )
    .map_err(|e| format!("Base64 解码失败: {}", e))?;

    // 保存为临时文件
    let tmp_dir = std::env::temp_dir();
    let tmp_path = tmp_dir.join(format!("ocr_{}.png", uuid::Uuid::new_v4()));

    fs::write(&tmp_path, &image_bytes)
        .map_err(|e| format!("保存临时图片失败: {}", e))?;

    // 执行识别
    let result = engine.recognize_from_file(&tmp_path);

    // 清理临时文件
    let _ = fs::remove_file(&tmp_path);

    result
}
