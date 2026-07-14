"""输入验证器"""

from dataclasses import dataclass
from typing import Any

ALLOWED_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java",
    ".md", ".json", ".yaml", ".yml", ".css", ".scss", ".sql",
    ".sh", ".bash", ".dockerfile", ".toml", ".xml", ".html",
    ".vue", ".svelte", ".c", ".cpp", ".h", ".hpp", ".rb",
    ".php", ".swift", ".kt", ".dart", ".txt",
}

MAX_FILE_SIZE = 1 * 1024 * 1024  # 1 MB
MAX_MESSAGE_LENGTH = 8000


@dataclass
class ValidationResult:
    valid: bool
    error: str | None = None


def validate_message_text(text: str) -> ValidationResult:
    if not text or text.strip() == "":
        return ValidationResult(False, "消息内容不能为空")
    if len(text) > MAX_MESSAGE_LENGTH:
        return ValidationResult(
            False, f"消息内容超出长度限制（最长 {MAX_MESSAGE_LENGTH} 字符）"
        )
    return ValidationResult(True)


def validate_file(file: dict[str, Any]) -> ValidationResult:
    name = file.get("name", "")
    size = file.get("size", 0)
    ext = "." + name.split(".")[-1].lower() if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        return ValidationResult(
            False,
            f'不支持的文件类型 "{ext}"。允许的类型：{", ".join(sorted(ALLOWED_EXTENSIONS))}',
        )
    if size > MAX_FILE_SIZE:
        return ValidationResult(
            False, f'文件 "{name}" 超出大小限制（最大 1MB）'
        )
    return ValidationResult(True)


def sanitize_content(content: str) -> str:
    """XSS 安全过滤"""
    import re
    content = re.sub(r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>', '', content, flags=re.IGNORECASE)
    content = re.sub(r'on\w+\s*=\s*["\'][^"\']*["\']', '', content, flags=re.IGNORECASE)
    content = re.sub(r'on\w+\s*=\s*[^\s>]+', '', content, flags=re.IGNORECASE)
    content = re.sub(r'javascript\s*:', 'blocked:', content, flags=re.IGNORECASE)
    return content
