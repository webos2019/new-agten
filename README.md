# Code Assistant (Python)

基于 FastAPI + DeepSeek API 的智能代码助手，支持工具调用、流式响应和文件上传。

## 功能特性

- **AI 对话**：基于 DeepSeek API 的智能聊天，支持流式输出
- **工具集成**：计算器、日期时间、文本转换、单位换算、天气查询、地理位置、网页浏览、文件读取、目录列表
- **双模式技能**：
  - **实用工具模式**：数学计算、日期查询、单位换算等
  - **文件与天气模式**：本地文件读取、实时天气查询、网页浏览
- **文件上传**：支持拖拽上传代码文件进行分析
- **结构化展示**：工具调用过程和结果以结构化卡片形式展示
- **错误恢复**：流式错误自动重试与回退
- **Markdown 渲染**：支持代码高亮、GFM 语法、复制按钮

## 技术栈

- **后端**：FastAPI + Uvicorn
- **AI**：OpenAI SDK (DeepSeek 兼容接口)
- **HTTP**：httpx (异步 HTTP 客户端)
- **前端**：原生 HTML + CSS + JavaScript (Tailwind CDN + marked + highlight.js)

## 快速开始

### 前置条件

- Python 3.11+
- DeepSeek API Key

### 安装

```bash
pip install -r requirements.txt
```

### 配置

复制 `.env.example` 为 `.env`，填入你的 DeepSeek API Key：

```env
DEEPSEEK_API_KEY=your-api-key-here
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

### 启动

```bash
python app.py
```

打开 http://localhost:8000 即可使用。

## 项目结构

```
newtaskpy/
  app.py              # FastAPI 主应用
  chat_service.py     # 聊天服务
  chat_session.py     # 聊天会话管理
  chat_orchestrator.py # 聊天编排器 (核心对话流程)
  deepseek.py         # DeepSeek API 客户端
  tool_registry.py    # 工具注册表
  skill_registry.py   # 技能注册表
  validators.py       # 输入验证
  tools/              # 工具实现
    __init__.py       # 自动注册所有工具和技能
    calculator.py     # 计算器
    datetime_tool.py  # 日期时间
    text_transform.py # 文本转换
    unit_convert.py   # 单位换算
    get_location.py   # 地理位置
    get_weather.py    # 天气查询 (wttr.in)
    web_browse.py     # 网页浏览
    local_text_read.py # 本地文件读取
    list_files.py     # 目录列表
  stream/             # 流式协议
    __init__.py
    protocol.py       # chunk 定义
    lifecycle.py     # 生命周期管理 + NDJSON 流
  static/             # 前端
    index.html        # 主页面
    styles.css        # 样式
    app.js            # 聊天逻辑
  requirements.txt
  .env.example
  README.md
```

## API 接口

### POST /api/chat

发送聊天消息，返回 NDJSON 流。

**请求体：**
```json
{
  "messages": [
    {"role": "user", "content": "1+2等于多少"}
  ],
  "skill": "utility-skill"
}
```

**响应：** NDJSON 流，每行一个 JSON chunk：

```json
{"type":"start","messageId":"..."}
{"type":"tool_call","toolCallId":"...","toolName":"calculator","toolArgs":{"expression":"1+2"}}
{"type":"tool_result","toolCallId":"...","toolName":"calculator","toolResult":"...","isValid":true}
{"type":"text","content":"1+2=3"}
{"type":"done"}
```

### GET /api/health

健康检查。

## License

MIT
