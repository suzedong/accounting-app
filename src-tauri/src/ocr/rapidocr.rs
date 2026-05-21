use std::path::PathBuf;
use std::process::Command;

/// RapidOCR 引擎
/// macOS 使用系统 "快捷指令"（Vision.framework 实时文本）
/// Windows/Linux 使用占位符（需要后续配置）
pub struct RapidOcr {
    #[allow(dead_code)]
    models_dir: PathBuf,
}

impl RapidOcr {
    /// 初始化 OCR 引擎
    pub fn new(models_dir: &PathBuf) -> Result<Self, String> {
        if !models_dir.exists() {
            return Err(format!("模型目录不存在: {}", models_dir.display()));
        }
        Ok(Self {
            models_dir: models_dir.clone(),
        })
    }

    /// 执行 OCR 识别
    ///
    /// macOS: 使用 `shortcuts` 调用 "提取图像中的文本" 快捷指令
    /// 其他平台: 返回占位提示
    pub fn recognize_from_file(&self, image_path: &PathBuf) -> Result<String, String> {
        // 尝试 macOS shortcuts 方式
        if cfg!(target_os = "macos") {
            return self.recognize_via_shortcuts(image_path);
        }

        // Windows/Linux 占位符
        Ok(format!(
            "[OCR 占位] 图片路径: {}\nOCR 需要配置：请在 Windows/Linux 上安装 RapidOCR CLI 或使用系统 OCR 工具",
            image_path.display()
        ))
    }

    /// 通过 macOS 快捷指令执行 OCR
    fn recognize_via_shortcuts(&self, image_path: &PathBuf) -> Result<String, String> {
        // 快捷指令名称（用户需要安装的 "提取图像中的文本" 快捷指令）
        let shortcut_name = "提取图像中的文本";

        let output = Command::new("shortcuts")
            .arg("run")
            .arg(shortcut_name)
            .arg("-i")
            .arg(image_path.to_str().ok_or("图片路径无效")?)
            .output()
            .map_err(|e| format!("启动快捷指令失败: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // 如果快捷指令不存在，给出友好提示
            if stderr.contains("not found") || stderr.contains("cannot be found") {
                return Err(format!(
                    "快捷指令「{}」未安装。\n\n请在 macOS 快捷指令 App 中创建名为「{}」的快捷指令：\n\
                    1. 打开「快捷指令」App\n\
                    2. 新建快捷指令\n\
                    3. 添加操作：「从输入中提取文本」（在「文本」分类中）\n\
                    4. 保存为「{}」\n\
                    5. 确保「在菜单栏中显示」已开启",
                    shortcut_name, shortcut_name, shortcut_name
                ));
            }
            return Err(format!("快捷指令执行失败: {}", stderr));
        }

        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(text)
    }
}
