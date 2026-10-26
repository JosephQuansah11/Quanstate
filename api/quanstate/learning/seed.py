"""Bundled offline translation memory.

This is the zero-dependency floor of the product: a curated travel/technical
phrasebook plus a bilingual lexicon.  It makes the device usable on a plane with
no network, keeps the hot path in microseconds, and gives uploaded documents
somewhere to attach.  Production installs pair it with an NLLB or HTTP provider
(``QUANSTATE_TRANSLATOR=nllb|http``) for open-domain coverage.
"""

from __future__ import annotations

# (source_language, target_language, source_phrase, target_phrase)
SEED_PHRASES: tuple[tuple[str, str, str, str], ...] = (
    ("en", "es", "hello", "hola"),
    ("en", "es", "good morning", "buenos días"),
    ("en", "es", "good afternoon", "buenas tardes"),
    ("en", "es", "good evening", "buenas noches"),
    ("en", "es", "goodbye", "adiós"),
    ("en", "es", "see you later", "hasta luego"),
    ("en", "es", "please", "por favor"),
    ("en", "es", "thank you", "gracias"),
    ("en", "es", "you're welcome", "de nada"),
    ("en", "es", "excuse me", "disculpe"),
    ("en", "es", "i'm sorry", "lo siento"),
    ("en", "es", "how are you", "¿cómo estás?"),
    ("en", "es", "i'm fine", "estoy bien"),
    ("en", "es", "what is your name", "¿cómo te llamas?"),
    ("en", "es", "my name is", "me llamo"),
    ("en", "es", "nice to meet you", "mucho gusto"),
    ("en", "es", "i don't understand", "no entiendo"),
    ("en", "es", "do you speak english", "¿hablas inglés?"),
    ("en", "es", "i don't speak spanish", "no hablo español"),
    ("en", "es", "i need help", "necesito ayuda"),
    ("en", "es", "where is the bathroom", "¿dónde está el baño?"),
    ("en", "es", "where is the train station", "¿dónde está la estación de tren?"),
    ("en", "es", "how much does it cost", "¿cuánto cuesta?"),
    ("en", "es", "the check please", "la cuenta, por favor"),
    ("en", "es", "i would like a coffee", "quisiera un café"),
    ("en", "es", "i have a reservation", "tengo una reserva"),
    ("en", "es", "call a doctor", "llame a un doctor"),
    ("en", "es", "is it safe", "¿es seguro?"),
    ("en", "es", "text to speech", "texto a voz"),
    ("en", "es", "speech to text", "voz a texto"),
    ("en", "es", "translation memory", "memoria de traducción"),
    ("en", "es", "real time", "tiempo real"),
    ("en", "fr", "hello", "bonjour"),
    ("en", "fr", "goodbye", "au revoir"),
    ("en", "fr", "please", "s'il vous plaît"),
    ("en", "fr", "thank you", "merci"),
    ("en", "fr", "i don't understand", "je ne comprends pas"),
    ("en", "fr", "do you speak english", "parlez-vous anglais ?"),
    ("en", "fr", "where is the bathroom", "où sont les toilettes ?"),
    ("en", "fr", "how much does it cost", "combien ça coûte ?"),
    ("en", "fr", "i need help", "j'ai besoin d'aide"),
    ("en", "fr", "i have a reservation", "j'ai une réservation"),
    ("en", "de", "hello", "hallo"),
    ("en", "de", "goodbye", "auf Wiedersehen"),
    ("en", "de", "please", "bitte"),
    ("en", "de", "thank you", "danke"),
    ("en", "de", "i don't understand", "ich verstehe nicht"),
    ("en", "de", "do you speak english", "sprechen Sie Englisch?"),
    ("en", "de", "where is the bathroom", "wo ist die Toilette?"),
    ("en", "de", "how much does it cost", "wie viel kostet das?"),
    ("en", "de", "i need help", "ich brauche Hilfe"),
    ("en", "pt", "hello", "olá"),
    ("en", "pt", "thank you", "obrigado"),
    ("en", "pt", "please", "por favor"),
    ("en", "pt", "goodbye", "até logo"),
    ("en", "pt", "i need help", "preciso de ajuda"),
    ("en", "pt", "where is the bathroom", "onde fica o banheiro?"),
    ("en", "it", "hello", "ciao"),
    ("en", "it", "thank you", "grazie"),
    ("en", "it", "please", "per favore"),
    ("en", "it", "goodbye", "arrivederci"),
    ("en", "it", "i need help", "ho bisogno di aiuto"),
    ("en", "nl", "hello", "hallo"),
    ("en", "nl", "thank you", "dank je"),
    ("en", "nl", "goodbye", "tot ziens"),
    ("en", "tr", "hello", "merhaba"),
    ("en", "tr", "thank you", "teşekkür ederim"),
    ("en", "tr", "goodbye", "güle güle"),
    ("en", "ja", "hello", "こんにちは"),
    ("en", "ja", "thank you", "ありがとう"),
    ("en", "ja", "goodbye", "さようなら"),
    ("en", "ja", "i don't understand", "わかりません"),
    ("en", "ko", "hello", "안녕하세요"),
    ("en", "ko", "thank you", "감사합니다"),
    ("en", "ko", "goodbye", "안녕히 가세요"),
    ("en", "zh", "hello", "你好"),
    ("en", "zh", "thank you", "谢谢"),
    ("en", "zh", "goodbye", "再见"),
    ("en", "zh", "i don't understand", "我不明白"),
)

_ES_EN_WORDS = {
    "i": "yo", "you": "tú", "he": "él", "she": "ella", "we": "nosotros", "they": "ellos",
    "my": "mi", "your": "tu", "our": "nuestro", "name": "nombre", "water": "agua",
    "food": "comida", "help": "ayuda", "thanks": "gracias", "hello": "hola", "goodbye": "adiós",
    "yes": "sí", "no": "no", "where": "dónde", "when": "cuándo", "what": "qué", "how": "cómo",
    "much": "mucho", "cost": "cuesta", "money": "dinero", "hotel": "hotel", "airport": "aeropuerto",
    "station": "estación", "train": "tren", "bus": "autobús", "taxi": "taxi", "doctor": "doctor",
    "hospital": "hospital", "pharmacy": "farmacia", "bathroom": "baño", "left": "izquierda",
    "right": "derecha", "straight": "recto", "here": "aquí", "there": "allí", "today": "hoy",
    "tomorrow": "mañana", "yesterday": "ayer", "morning": "mañana", "night": "noche",
    "good": "bueno", "bad": "malo", "big": "grande", "small": "pequeño", "hot": "caliente",
    "cold": "frío", "open": "abierto", "closed": "cerrado", "speak": "hablar", "english": "inglés",
    "spanish": "español", "language": "idioma", "translate": "traducir", "device": "dispositivo",
    "microphone": "micrófono", "speech": "voz", "document": "documento", "video": "vídeo",
    "learn": "aprender", "friend": "amigo", "family": "familia", "work": "trabajo",
    "meeting": "reunión", "time": "tiempo", "wait": "esperar", "now": "ahora", "later": "después",
    "again": "otra vez", "more": "más", "less": "menos", "very": "muy", "and": "y", "or": "o",
    "but": "pero", "with": "con", "without": "sin", "for": "para", "from": "de", "to": "a",
    "in": "en", "on": "en", "at": "en", "this": "este", "that": "ese", "do": "hacer",
    "can": "poder", "want": "querer", "need": "necesito", "like": "gusta", "have": "tengo",
    "eat": "comer", "drink": "beber", "go": "ir", "come": "venir", "buy": "comprar",
    "pay": "pagar", "call": "llamar", "find": "encontrar", "lost": "perdido", "ticket": "billete",
    "passport": "pasaporte", "reservation": "reserva", "room": "habitación", "table": "mesa",
    "menu": "menú", "bill": "cuenta", "coffee": "café", "tea": "té", "beer": "cerveza",
    "bread": "pan", "chicken": "pollo", "fish": "pescado", "emergency": "emergencia",
    "police": "policía", "danger": "peligro", "safe": "seguro", "prices": "precios",
    "translation": "traducción", "memory": "memoria", "voice": "voz", "text": "texto",
    "real": "real", "system": "sistema", "upload": "subir", "download": "descargar",
    "quality": "calidad", "sentence": "frase", "word": "palabra", "conversation": "conversación",
    "the": "el", "is": "es", "are": "son", "was": "era", "were": "eran", "of": "de",
    "a": "un", "an": "un", "it": "eso", "not": "no",
    "i'm": "estoy", "don't": "no", "does": "hace", "has": "tiene", "these": "estos",
    "those": "esos",
    "good morning": "buenos días", "good night": "buenas noches", "how much": "cuánto",
}

_FR_WORDS = {
    "hello": "bonjour", "thank you": "merci", "please": "s'il vous plaît", "water": "eau",
    "food": "nourriture", "help": "aide", "yes": "oui", "no": "non", "where": "où",
    "how": "comment", "much": "beaucoup", "train": "train", "station": "gare", "hotel": "hôtel",
    "doctor": "médecin", "bathroom": "toilettes", "left": "gauche", "right": "droite",
    "today": "aujourd'hui", "tomorrow": "demain", "good": "bon", "bad": "mauvais",
    "speak": "parler", "english": "anglais", "language": "langue", "translate": "traduire",
    "time": "temps", "need": "besoin", "have": "avoir", "want": "vouloir", "coffee": "café",
    "reservation": "réservation", "room": "chambre", "menu": "menu", "bill": "addition",
    "the": "le", "is": "est", "are": "sont", "a": "un", "an": "un", "of": "de",
    "to": "à", "and": "et", "with": "avec", "for": "pour", "i": "je", "you": "vous",
}

_DE_WORDS = {
    "hello": "hallo", "thank you": "danke", "please": "bitte", "water": "Wasser",
    "food": "Essen", "help": "Hilfe", "yes": "ja", "no": "nein", "where": "wo",
    "how": "wie", "much": "viel", "train": "Zug", "station": "Bahnhof", "hotel": "Hotel",
    "doctor": "Arzt", "bathroom": "Toilette", "left": "links", "right": "rechts",
    "today": "heute", "tomorrow": "morgen", "good": "gut", "bad": "schlecht",
    "speak": "sprechen", "english": "Englisch", "language": "Sprache", "translate": "übersetzen",
    "time": "Zeit", "need": "brauchen", "have": "haben", "want": "wollen", "coffee": "Kaffee",
    "reservation": "Reservierung", "room": "Zimmer", "menu": "Speisekarte", "bill": "Rechnung",
    "the": "der", "is": "ist", "are": "sind", "a": "ein", "an": "ein", "of": "von",
    "to": "zu", "and": "und", "with": "mit", "for": "für", "i": "ich", "you": "du",
}


def seed_phrases() -> list[tuple[str, str, str, str]]:
    """Seed pairs in both directions so every seeded pair works both ways."""

    pairs: list[tuple[str, str, str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for source_lang, target_lang, source, target in SEED_PHRASES:
        for src_lang, tgt_lang, src, tgt in (
            (source_lang, target_lang, source, target),
            (target_lang, source_lang, target, source),
        ):
            key = (src_lang, tgt_lang, src.lower())
            if key in seen:
                continue
            seen.add(key)
            pairs.append((src_lang, tgt_lang, src, tgt))
    return pairs


def seed_lexicon() -> dict[tuple[str, str], dict[str, str]]:
    lexicon: dict[tuple[str, str], dict[str, str]] = {("en", "es"): dict(_ES_EN_WORDS)}
    lexicon[("es", "en")] = {value.lower(): key for key, value in _ES_EN_WORDS.items()}
    lexicon[("en", "fr")] = dict(_FR_WORDS)
    lexicon[("fr", "en")] = {value.lower(): key for key, value in _FR_WORDS.items()}
    lexicon[("en", "de")] = dict(_DE_WORDS)
    lexicon[("de", "en")] = {value.lower(): key for key, value in _DE_WORDS.items()}
    return lexicon

