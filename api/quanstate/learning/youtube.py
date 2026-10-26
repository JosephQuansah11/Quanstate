"""YouTube ingestion.

Downloads a caption track (and, when available, the translated track for the
target language), then mines it for phrase pairs and domain terminology.  The
fetcher is injectable so the learning pipeline is testable offline.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Protocol

from .store import MemoryStore

YOUTUBE_ID_RE = re.compile(r"(?:v=|/shorts/|/embed/|youtu\.be/|/live/)([A-Za-z0-9_-]{11})")


class YouTubeError(RuntimeError):
    pass


def parse_video_id(url: str) -> str:
    if not url:
        raise YouTubeError("a YouTube URL is required")
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url.strip()):
        return url.strip()
    match = YOUTUBE_ID_RE.search(url)
    if not match:
        raise YouTubeError(f"could not find a YouTube video id in {url!r}")
    return match.group(1)


@dataclass(frozen=True)
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str


class TranscriptFetcher(Protocol):
    async def fetch(
        self, video_id: str, language: str, translate_to: str | None = None
    ) -> tuple[str, list[TranscriptSegment]]:
        """Return ``(track_language, segments)``."""


class HttpYouTubeFetcher:
    """Caption fetcher using YouTube's public timedtext endpoints.

    No API key is needed.  We scrape the watch page for ``captionTracks`` and
    request JSON3 captions; ``tlang`` asks YouTube for the machine-translated
    track, which is what lets an English video teach a Spanish phrasebook.
    """

    WATCH_URL = "https://www.youtube.com/watch"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; Quanstate/1.0; +https://quanstate.local)",
        "Accept-Language": "en-US,en;q=0.8",
    }

    def __init__(self, timeout: float = 12.0) -> None:
        self.timeout = timeout

    async def fetch(
        self, video_id: str, language: str, translate_to: str | None = None
    ) -> tuple[str, list[TranscriptSegment]]:
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - httpx ships with the service extras
            raise YouTubeError("YouTube ingestion needs the 'httpx' dependency") from exc

        async with httpx.AsyncClient(timeout=self.timeout, headers=self.HEADERS, follow_redirects=True) as client:
            try:
                page = await client.get(self.WATCH_URL, params={"v": video_id, "hl": "en"})
                page.raise_for_status()
            except Exception as exc:
                raise YouTubeError(f"could not load YouTube page: {exc}") from exc

            tracks = self._caption_tracks(page.text)
            if not tracks:
                raise YouTubeError("this video has no caption track to learn from")

            base = language.split("-")[0].lower()
            track = next((item for item in tracks if item.get("languageCode", "").startswith(base)), None)
            if track is None:
                track = next((item for item in tracks if item.get("languageCode", "").startswith("en")), tracks[0])
            resolved_language = track.get("languageCode", base)

            params: dict[str, str] = {"fmt": "json3", "v": video_id}
            if translate_to:
                params["tlang"] = translate_to
            try:
                response = await client.get(track["baseUrl"], params=params)
                response.raise_for_status()
            except Exception as exc:
                raise YouTubeError(f"could not download captions: {exc}") from exc
            return resolved_language, self.parse_json3(response.text, translate_to or resolved_language)

    @staticmethod
    def _caption_tracks(html: str) -> list[dict[str, Any]]:
        match = re.search(r'"captionTracks":(\[.*?\])', html)
        if not match:
            return []
        try:
            tracks = json.loads(match.group(1))
        except ValueError:
            return []
        return [track for track in tracks if isinstance(track, dict) and track.get("baseUrl")]

    @staticmethod
    def parse_json3(payload: str, language: str = "") -> list[TranscriptSegment]:
        try:
            data = json.loads(payload)
        except ValueError:
            return []
        segments: list[TranscriptSegment] = []
        for event in data.get("events", []):
            pieces = [seg.get("utf8", "") for seg in event.get("segs", []) if seg.get("utf8")]
            text = re.sub(r"\s+", " ", "".join(pieces)).strip()
            if not text:
                continue
            start = int(event.get("tStartMs", 0))
            duration = int(event.get("dDurationMs", 0))
            segments.append(TranscriptSegment(start_ms=start, end_ms=start + duration, text=text))
        return segments



class YouTubeLearner:
    def __init__(self, store: MemoryStore, fetcher: TranscriptFetcher | None = None) -> None:
        self.store = store
        self.fetcher = fetcher or HttpYouTubeFetcher()

    async def learn(
        self,
        url: str,
        source_lang: str,
        target_lang: str,
        profile: str = "default",
        bilingual: bool = True,
    ) -> dict[str, Any]:
        video_id = parse_video_id(url)
        track_language, segments = await self.fetcher.fetch(video_id, source_lang, target_lang if bilingual else None)
        if not segments:
            raise YouTubeError("the caption track was empty")

        lines: list[str] = [segment.text for segment in segments if segment.text]
        text = "\n".join(lines)

        # Use the translated track as a parallel corpus when YouTube has one.
        pairs: list[tuple[str, str]] = []
        if bilingual and track_language.split("-")[0] == source_lang.split("-")[0]:
            try:
                translated_language, translated = await self.fetcher.fetch(video_id, target_lang, None)
                if translated_language.split("-")[0] == target_lang.split("-")[0]:
                    pairs = [
                        (original.text, translation.text)
                        for original, translation in zip(segments, translated)
                        if original.text and translation.text and original.text != translation.text
                    ]
            except YouTubeError:
                pairs = []

        if pairs:
            self.store.add_phrases(profile, source_lang, target_lang, pairs, origin="youtube", weight=1.4)
            self.store.add_phrases(
                profile, target_lang, source_lang, [(b, a) for a, b in pairs], origin="youtube", weight=1.4
            )
            text = "\n".join(f"{source} = {target}" for source, target in pairs) + "\n" + text

        record = self.store.learn_text(
            profile,
            source_lang,
            target_lang,
            text,
            origin="youtube",
            title=f"YouTube {video_id}",
            url=url,
            metadata={
                "videoId": video_id,
                "captionLanguage": track_language,
                "segments": len(segments),
                "bilingualPairs": len(pairs),
                "translatedTrack": bool(pairs),
            },
        )
        return {**record, "videoId": video_id, "segments": len(segments), "bilingualPairs": len(pairs)}
