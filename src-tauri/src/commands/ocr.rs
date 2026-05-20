#[tauri::command]
pub async fn ocr_recognize(image_base64: String) -> Result<String, String> {
    // TODO: implement RapidOCR
    Ok(format!("[OCR占位] 收到 {} 字符的 base64 图片", image_base64.len()))
}
