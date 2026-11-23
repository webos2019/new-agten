"""语音 TTS API - 微软 edge-tts 朗读"""
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse

router = APIRouter(prefix="/api/tts", tags=["语音"])


@router.get("/voices")
async def tts_voices():
    """获取可用的 TTS 语音列表 (过滤 zh/en)"""
    try:
        import edge_tts
        voices = await edge_tts.list_voices()
        filtered = []
        for v in voices:
            locale = v.get("Locale", "")
            if locale.startswith("zh") or locale.startswith("en"):
                filtered.append({
                    "name": v.get("ShortName", ""),
                    "locale": locale,
                    "gender": v.get("Gender", ""),
                    "friendly_name": v.get("FriendlyName", ""),
                })
        return {"voices": filtered}
    except ImportError:
        return JSONResponse({"error": "edge-tts 未安装，请运行 pip install edge-tts"}, status_code=500)
    except Exception as e:
        return JSONResponse({"error": f"获取语音列表失败: {e}"}, status_code=500)


@router.post("/synthesize")
async def tts_synthesize(request: Request):
    """文字转语音 — 使用微软 edge-tts 合成音频"""
    try:
        import edge_tts
    except ImportError:
        return JSONResponse({"error": "edge-tts 未安装"}, status_code=500)

    body = await request.json()
    text = body.get("text", "").strip()
    voice = body.get("voice", "zh-CN-XiaoxiaoNeural")
    rate = body.get("rate", "+0%")
    volume = body.get("volume", "+0%")

    if not text:
        return JSONResponse({"error": "text 不能为空"}, status_code=400)

    if len(text) > 3000:
        return JSONResponse({"error": "文本过长（最多 3000 字）"}, status_code=400)

    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate, volume=volume)

        async def audio_stream():
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]

        return StreamingResponse(audio_stream(), media_type="audio/mpeg")
    except Exception as e:
        return JSONResponse({"error": f"语音合成失败: {e}"}, status_code=500)
