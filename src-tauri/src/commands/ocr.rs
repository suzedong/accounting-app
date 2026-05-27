use std::process::Command;
use tauri::State;
use serde::Serialize;

use crate::commands::config::AppConfig;
use crate::db::Database;

// --- Python Detection ---

/// 跨平台 Python 可执行文件路径
#[derive(Debug, Clone, Serialize)]
pub struct PythonInfo {
    pub path: String,
    pub version: String,
    pub has_paddleocr: bool,
}

/// 探测系统 Python（跨平台、多路径尝试）
fn detect_python() -> Option<PythonInfo> {
    // 候选命令（按优先级排序）
    let candidates = if cfg!(windows) {
        vec!["py", "python", "python3", "python3.11", "python3.12"]
    } else if cfg!(target_os = "macos") {
        vec!["python3", "python", "/usr/bin/python3", "/opt/homebrew/bin/python3"]
    } else {
        vec!["python3", "python", "/usr/bin/python3"]
    };

    for cmd in &candidates {
        if let Some(info) = try_python_cmd(cmd) {
            debug_log(&format!("[python] found: path={}, version={}, has_paddleocr={}",
                info.path, info.version, info.has_paddleocr));
            return Some(info);
        }
    }

    // Windows 额外尝试常见安装路径
    if cfg!(windows) {
        let common_paths = [
            "C:\\Python311\\python.exe",
            "C:\\Python312\\python.exe",
            "C:\\Program Files\\Python311\\python.exe",
            "C:\\Program Files\\Python312\\python.exe",
        ];
        for path in &common_paths {
            if let Some(info) = try_python_cmd(path) {
                debug_log(&format!("[python] found (common path): path={}, version={}, has_paddleocr={}",
                    info.path, info.version, info.has_paddleocr));
                return Some(info);
            }
        }
    }

    None
}

/// 尝试执行一个 Python 命令，返回版本和 paddleocr 状态
fn try_python_cmd(cmd: &str) -> Option<PythonInfo> {
    // 先检查版本
    let version_output = Command::new(cmd)
        .arg("--version")
        .output()
        .ok()?;

    if !version_output.status.success() {
        return None;
    }

    let version = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string();

    // 检查 paddleocr 是否可用
    let has_paddleocr = check_module(cmd, "paddleocr").unwrap_or(false);

    Some(PythonInfo {
        path: cmd.to_string(),
        version,
        has_paddleocr,
    })
}

/// 检查指定 Python 是否安装了某个模块
fn check_module(python: &str, module: &str) -> Option<bool> {
    let output = Command::new(python)
        .arg("-c")
        .arg(format!("import {}; print('ok')", module))
        .output()
        .ok()?;
    Some(output.status.success())
}

// --- Auto Install ---

/// 自动安装 paddleocr（首次使用时调用）
fn install_paddleocr(python: &str) -> Result<String, String> {
    debug_log(&format!("[install] installing paddleocr via {}", python));

    // 先安装 paddlepaddle（CPU 版），再安装 paddleocr
    let packages = ["paddlepaddle", "paddleocr"];

    for pkg in &packages {
        // Skip if already installed
        if check_module(python, pkg.split('-').next().unwrap()).unwrap_or(false) {
            debug_log(&format!("[install] {} already installed", pkg));
            continue;
        }

        debug_log(&format!("[install] installing {}...", pkg));

        let output = Command::new(python)
            .args(["-m", "pip", "install", "--quiet", "--upgrade", pkg])
            .output()
            .map_err(|e| format!("pip 启动失败: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            debug_log(&format!("[install] {} failed: {}", pkg, stderr));
            return Err(format!("安装 {} 失败: {}", pkg, stderr.lines().last().unwrap_or(&stderr)));
        }

        debug_log(&format!("[install] {} installed successfully", pkg));
    }

    Ok("安装完成".to_string())
}

// --- Status ---

#[derive(Serialize)]
pub struct OcrStatus {
    pub available: bool,
    pub enabled: bool,
    pub python: Option<PythonInfo>,
    pub message: String,
}

/// 检查 OCR 引擎状态
#[tauri::command]
pub fn check_ocr_status(app_config: State<'_, AppConfig>) -> Result<OcrStatus, String> {
    let enabled = {
        let config_guard = app_config.data.lock().map_err(|e| e.to_string())?;
        config_guard.get("ocr_enabled")
            .map(|v| v == "true")
            .unwrap_or(true)
    };

    if !enabled {
        return Ok(OcrStatus {
            available: false,
            enabled: false,
            python: None,
            message: "OCR 已禁用".to_string(),
        });
    }

    match detect_python() {
        Some(info) => {
            let available = info.has_paddleocr;
            let message = if available {
                "PaddleOCR 已就绪".to_string()
            } else {
                format!("Python 已安装 ({}), 需要安装 paddleocr 依赖", info.version)
            };
            Ok(OcrStatus {
                available,
                enabled: true,
                python: Some(info),
                message,
            })
        }
        None => Ok(OcrStatus {
            available: false,
            enabled: true,
            python: None,
            message: "未找到 Python，请安装 Python 3.11+ (https://www.python.org/downloads/)".to_string(),
        })
    }
}

/// 安装 PaddleOCR 依赖
#[tauri::command]
pub async fn install_ocr_dependencies() -> Result<String, String> {
    let python_info = detect_python().ok_or("未找到 Python，请先安装 Python")?;

    if python_info.has_paddleocr {
        return Ok("PaddleOCR 已安装，无需重复安装".to_string());
    }

    install_paddleocr(&python_info.path)
}

/// 设置 OCR 启用状态（持久化到数据库）
#[tauri::command]
pub async fn set_ocr_enabled(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
    enabled: bool,
) -> Result<(), String> {
    let val = if enabled { "true" } else { "false" };

    {
        let conn = state.get_conn();
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        conn_guard
            .execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                ("ocr_enabled", val),
            )
            .map_err(|e| e.to_string())?;
    }

    {
        let mut config_guard = app_config.data.lock().map_err(|e| e.to_string())?;
        config_guard.insert("ocr_enabled".to_string(), val.to_string());
    }

    Ok(())
}

// --- OCR Recognition ---

/// 执行 OCR 识别
#[tauri::command]
pub async fn ocr_recognize(
    app_config: State<'_, AppConfig>,
    image_base64: String,
) -> Result<String, String> {
    // Check if OCR is enabled
    {
        let config_guard = app_config.data.lock().map_err(|e| e.to_string())?;
        if config_guard.get("ocr_enabled").map(|v| v != "true").unwrap_or(false) {
            return Err("OCR 识别已关闭".to_string());
        }
    }

    // Detect Python
    let python_info = detect_python()
        .ok_or("未找到 Python，请先安装 Python 3.11+ 并在设置中安装依赖")?;

    if !python_info.has_paddleocr {
        return Err("PaddleOCR 未安装，请在设置中点击「安装依赖」".to_string());
    }

    // Remove data URI prefix
    let clean_base64 = if image_base64.contains(',') {
        image_base64.split(',').last().unwrap_or(&image_base64).to_string()
    } else {
        image_base64
    };

    // Find ocr_service.py
    let script_dir = find_script_dir()
        .ok_or("找不到 server/ocr_service.py，请确保项目结构正确")?;

    call_paddle_ocr(&python_info.path, &script_dir, &clean_base64)
}

/// 调用 PaddleOCR
fn call_paddle_ocr(python: &str, script_dir: &std::path::Path, base64_str: &str) -> Result<String, String> {
    // Write base64 to temp file
    let tmp_dir = std::env::temp_dir();
    let b64_path = tmp_dir.join(format!("ocr_b64_{}.txt", uuid::Uuid::new_v4()));
    std::fs::write(&b64_path, base64_str)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    // Wrapper script
    let wrapper = format!(
        r#"
import sys, os
sys.path.insert(0, r'{script_dir}')
from ocr_service import recognize_image
with open(r'{b64_path}', 'r', encoding='utf-8') as f:
    b64 = f.read()
result = recognize_image(b64)
print(result['text'])
"#,
        script_dir = script_dir.display(),
        b64_path = b64_path.display(),
    );

    let output = Command::new(python)
        .arg("-c")
        .arg(wrapper)
        .env("PYTHONIOENCODING", "utf-8")
        .output()
        .map_err(|e| format!("启动 Python 失败: {}", e))?;

    // Cleanup
    let _ = std::fs::remove_file(&b64_path);

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            Ok("未识别到文字".to_string())
        } else {
            Ok(format!("[OCR 识别结果]\n{}", text))
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        debug_log(&format!("[ocr] python error: {}", stderr));
        Err(format!("OCR 识别失败: {}", stderr.lines().last().unwrap_or(&stderr)))
    }
}

// --- Helpers ---

/// 查找 server/ocr_service.py 所在目录
fn find_script_dir() -> Option<std::path::PathBuf> {
    // 尝试多个相对路径
    let candidates = [
        "server/ocr_service.py",
        "../server/ocr_service.py",
        "../../server/ocr_service.py",
        // 打包后从 exe 目录查找
        "resources/server/ocr_service.py",
    ];

    for path in &candidates {
        let p = std::path::Path::new(path);
        if p.exists() {
            return p.parent().map(|p| p.to_path_buf());
        }
    }

    None
}

fn debug_log(msg: &str) {
    use std::io::Write;
    let path = std::path::PathBuf::from("D:\\Code\\accounting-app\\ocr_debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", msg);
    }
}
