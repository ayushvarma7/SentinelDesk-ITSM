"""Mock triage that returns the exact TriageResult shape without torch/numpy/artifacts.

Classification and retrieval are faked with a keyword topic library, but the decision
logic is the project's own: gate.evaluate() (real thresholds and risk regexes),
pii.mask() (real tokens) and generate.unsupported_figures() (real figure check).
"""
from __future__ import annotations

import hashlib
import re
import time
from collections import deque

from sentineldesk import config, gate, pii
from sentineldesk.generate import unsupported_figures
from sentineldesk.schema import Precedent, Prediction, TriageResult
from sentineldesk.text import build_text

QUEUES = [
    "Technical Support", "Product Support", "Customer Service", "IT Support",
    "Billing and Payments", "Returns and Exchanges", "Service Outages and Maintenance",
    "Sales and Pre-Sales", "Human Resources", "General Inquiry",
]


def P(tid, score, subj, snip, ans, lang, queue):
    return dict(ticket_id=tid, score=score, subject=subj, body_snippet=snip, answer=ans,
                language=lang, queue=queue)


# topic -> keywords, labels, precedents, draft templates
TOPICS: dict[str, dict] = {
    "vpn_outage": {
        "kw": ["vpn", "remote access", "tunnel", "fernzugriff", "fernzugang", "anyconnect"],
        "type": "Incident", "queue": "Technical Support", "priority": "high", "burst": True,
        "precedents": [
            P("TKT-10234", 0.912, "VPN connection drops every few minutes",
              "Users at the clinic report the VPN tunnel dropping every 5-10 minutes since the update...",
              "We identified a stale IKE policy on the VPN concentrator and rotated it. The tunnel has been "
              "stable since. Please reconnect your client; if the drop recurs, send us the client log.",
              "en", "Technical Support"),
            P("TKT-18842", 0.897, "VPN-Verbindung bricht ständig ab",
              "Seit heute Morgen bricht die VPN-Verbindung für alle Mitarbeiter im Außendienst ab...",
              "Ursache war ein abgelaufenes Zertifikat am Gateway. Wir haben es ersetzt und die Verbindung "
              "24 Stunden lang überwacht. Bitte verbinden Sie den Client neu.",
              "de", "Technical Support"),
            P("TKT-04567", 0.881, "Remote access unavailable",
              "Remote access has been unavailable since this morning for the whole night shift...",
              "Root cause was an expired certificate on the gateway. We replaced it and monitored the service "
              "for 24 hours. Reconnect the client to pick up the new certificate.",
              "en", "IT Support"),
        ],
        "draft": {
            "en": "Thank you for reporting the VPN drops. A very similar issue was caused by a stale IKE policy "
                  "on the concentrator, which we rotated [TKT-10234]; another case was an expired gateway "
                  "certificate that we replaced [TKT-04567]. Please reconnect your client. If the tunnel drops "
                  "again, send us the client log and we will check the gateway certificate.",
            "de": "Vielen Dank für Ihre Meldung. Ein sehr ähnlicher Fall wurde durch ein abgelaufenes Zertifikat "
                  "am Gateway verursacht, das wir ersetzt haben [TKT-18842]. Bitte verbinden Sie den Client neu. "
                  "Falls die Verbindung erneut abbricht, senden Sie uns bitte das Client-Protokoll.",
        },
    },
    "billing_double": {
        "kw": ["double charge", "charged twice", "doppelt", "zweimal abgebucht", "abbuchung", "invoice",
               "rechnung", "billing", "duplicate payment", "abgebucht"],
        "type": "Problem", "queue": "Billing and Payments", "priority": "medium",
        "precedents": [
            P("TKT-22107", 0.903, "Doppelte Abbuchung im März",
              "Uns wurde die Monatsgebühr für März zweimal abgebucht...",
              "Die doppelte Abbuchung entstand durch einen Wiederholungsversuch im Zahlungssystem. Wir haben "
              "die zweite Buchung storniert; der Betrag wird innerhalb von 5 Werktagen gutgeschrieben.",
              "de", "Billing and Payments"),
            P("TKT-13390", 0.889, "Charged twice for subscription",
              "Our card was charged twice for the annual subscription...",
              "The duplicate charge came from a payment retry. We voided the second transaction; the amount "
              "is returned to the card within 5 business days.",
              "en", "Billing and Payments"),
            P("TKT-09981", 0.872, "Invoice amount wrong",
              "The invoice shows 12 seats but we only have 10 active users...",
              "We corrected the seat count on the invoice and issued an updated PDF.",
              "en", "Billing and Payments"),
        ],
        "draft": {
            "en": "Thank you for flagging the duplicate charge. In a matching case the second charge came from a "
                  "payment retry and was voided, with the amount returned within 5 business days [TKT-13390]. "
                  "We are checking your transaction now and will confirm once the second charge is voided.",
            "de": "Vielen Dank für Ihren Hinweis zur doppelten Abbuchung. In einem gleichartigen Fall entstand "
                  "die zweite Buchung durch einen Wiederholungsversuch und wurde storniert; der Betrag wurde "
                  "innerhalb von 5 Werktagen gutgeschrieben [TKT-22107]. Wir prüfen Ihre Buchung und melden "
                  "uns, sobald die zweite Abbuchung storniert ist.",
        },
    },
    "password": {
        "kw": ["password", "passwort", "reset", "zurücksetzen", "locked out", "gesperrt", "login", "anmelden",
               "mfa", "2fa", "kennwort"],
        "type": "Request", "queue": "IT Support", "priority": "low",
        "precedents": [
            P("TKT-31055", 0.921, "Password reset link not arriving",
              "I requested a password reset but never got the email...",
              "Reset emails were held by the spam filter. We whitelisted the sender; please request the reset "
              "again and check the inbox within a few minutes.",
              "en", "IT Support"),
            P("TKT-27741", 0.906, "Konto nach Passwortänderung gesperrt",
              "Nach der Passwortänderung ist mein Konto gesperrt...",
              "Das Konto wurde nach mehreren Fehlversuchen automatisch gesperrt. Wir haben es entsperrt; bitte "
              "melden Sie sich mit dem neuen Passwort an.",
              "de", "IT Support"),
            P("TKT-30012", 0.884, "Locked out after MFA change",
              "Got a new phone and now MFA fails...",
              "We reset the MFA enrolment. On next login you will be asked to register the new device.",
              "en", "IT Support"),
        ],
        "draft": {
            "en": "Thanks for reaching out. Reset emails have previously been held by the spam filter; we "
                  "whitelisted the sender, so please request the reset again [TKT-31055]. If your account is "
                  "locked after several attempts, we can unlock it for you [TKT-27741].",
            "de": "Vielen Dank für Ihre Nachricht. Konten werden nach mehreren Fehlversuchen automatisch "
                  "gesperrt; wir haben in einem gleichen Fall das Konto entsperrt [TKT-27741]. Bitte fordern "
                  "Sie die Zurücksetzung erneut an und prüfen Sie auch den Spam-Ordner [TKT-31055].",
        },
    },
    "refund_sla": {
        "kw": ["refund", "sla", "compensation", "erstattung", "rückerstattung", "entschädigung", "credit note",
               "gutschrift", "money back"],
        "type": "Request", "queue": "Customer Service", "priority": "high",
        "precedents": [
            P("TKT-40211", 0.874, "Downtime last week",
              "Our portal was down for several hours last week...",
              "We apologise for the downtime. The root cause was a failed storage node, which has been replaced.",
              "en", "Customer Service"),
            P("TKT-38820", 0.861, "Beschwerde über Ausfall",
              "Der Dienst war am Montag nicht verfügbar...",
              "Wir entschuldigen uns für den Ausfall. Die Ursache wurde behoben.",
              "de", "Customer Service"),
            P("TKT-35512", 0.852, "Contract question",
              "We want to understand the uptime terms in our contract...",
              "Your account manager will walk you through the contract terms.",
              "en", "Sales and Pre-Sales"),
        ],
        "draft": {
            "en": "We apologise for the downtime. The root cause in a comparable case was a failed storage node "
                  "that has been replaced [TKT-40211]. We will credit 25% of the monthly fee.",
            "de": "Wir entschuldigen uns für den Ausfall [TKT-38820]. Wir erstatten 25% der Monatsgebühr.",
        },
    },
    "server_down": {
        "kw": ["server down", "database", "datenbank", "production", "produktion", "500 error", "website down",
               "site is down", "ausgefallen", "ausfall", "outage", "not reachable", "nicht erreichbar"],
        "type": "Incident", "queue": "Service Outages and Maintenance", "priority": "high", "burst": True,
        "precedents": [
            P("TKT-50017", 0.894, "Production database unreachable",
              "Our production DB stopped accepting connections at 08:10...",
              "The connection pool was exhausted after a deploy. We restarted the pool and raised the limit; "
              "the service recovered and we are monitoring.",
              "en", "Service Outages and Maintenance"),
            P("TKT-52240", 0.879, "Webshop nicht erreichbar",
              "Unser Webshop liefert seit 30 Minuten nur Fehler 502...",
              "Ein Lastverteiler war fehlerhaft konfiguriert. Wir haben die Konfiguration zurückgesetzt.",
              "de", "Service Outages and Maintenance"),
            P("TKT-48803", 0.868, "API returning 500",
              "All API calls return HTTP 500...",
              "A failed migration left a lock on a table. We released the lock and re-ran the migration.",
              "en", "Technical Support"),
        ],
        "draft": {
            "en": "We are looking into the outage. A comparable case was an exhausted connection pool after a "
                  "deploy, resolved by restarting the pool [TKT-50017].",
            "de": "Wir prüfen den Ausfall. In einem ähnlichen Fall war ein Lastverteiler fehlerhaft "
                  "konfiguriert [TKT-52240].",
        },
    },
    "email_sync": {
        "kw": ["outlook", "email sync", "mailbox", "postfach", "e-mail", "calendar", "kalender", "exchange",
               "synchron"],
        "type": "Incident", "queue": "IT Support", "priority": "medium",
        "precedents": [
            P("TKT-60018", 0.908, "Outlook not syncing",
              "Outlook stopped syncing new mail since yesterday...",
              "The local OST cache was corrupted. Closing Outlook, renaming the OST file and restarting rebuilt "
              "the cache and sync resumed.",
              "en", "IT Support"),
            P("TKT-61190", 0.893, "Kalender synchronisiert nicht",
              "Mein Kalender auf dem Handy zeigt keine neuen Termine...",
              "Das Exchange-Konto auf dem Mobilgerät musste neu hinzugefügt werden. Danach lief die "
              "Synchronisation wieder.",
              "de", "IT Support"),
            P("TKT-59874", 0.881, "Mailbox full warnings",
              "Getting mailbox full warnings...",
              "We archived mail older than 2 years and raised the quota.", "en", "IT Support"),
        ],
        "draft": {
            "en": "Thanks for the details. In a matching case the local Outlook cache was corrupted; closing "
                  "Outlook, renaming the OST file and restarting rebuilt it and sync resumed within 15 minutes "
                  "[TKT-60018]. If "
                  "only your phone is affected, re-adding the Exchange account fixes it [TKT-61190].",
            "de": "Danke für die Details. In einem gleichen Fall musste das Exchange-Konto auf dem Mobilgerät "
                  "neu hinzugefügt werden, danach lief die Synchronisation wieder [TKT-61190]. Betrifft es "
                  "Outlook am PC, hilft das Neuaufbauen des lokalen Caches [TKT-60018].",
        },
    },
    "printer": {
        "kw": ["printer", "drucker", "print", "drucken", "scanner", "toner"],
        "type": "Incident", "queue": "IT Support", "priority": "low",
        "precedents": [
            P("TKT-70031", 0.915, "Printer offline on floor 3",
              "The shared printer shows offline for everyone...",
              "The printer had picked up a new IP address. We set a DHCP reservation and re-added the queue.",
              "en", "IT Support"),
            P("TKT-71102", 0.899, "Drucker druckt nicht",
              "Druckaufträge bleiben in der Warteschlange hängen...",
              "Der Druckspooler hing. Nach einem Neustart des Spooler-Dienstes wurden die Aufträge gedruckt.",
              "de", "IT Support"),
            P("TKT-69950", 0.874, "Scanner to email broken",
              "Scan to email stopped working...", "We updated the SMTP relay settings on the device.",
              "en", "IT Support"),
        ],
        "draft": {
            "en": "Thanks for reporting this. Last time the printer had picked up a new IP address; we set a "
                  "DHCP reservation and re-added the queue [TKT-70031]. If jobs are stuck instead, restarting "
                  "the print spooler clears them [TKT-71102].",
            "de": "Danke für Ihre Meldung. In einem gleichen Fall hing der Druckspooler; nach einem Neustart "
                  "des Dienstes wurden die Aufträge gedruckt [TKT-71102].",
        },
    },
    "access_request": {
        "kw": ["new employee", "onboarding", "neuer mitarbeiter", "license", "lizenz", "access to", "zugriff auf",
               "install", "installieren", "software", "account for", "berechtigung"],
        "type": "Request", "queue": "IT Support", "priority": "low",
        "precedents": [
            P("TKT-80044", 0.902, "Account for new hire",
              "Please create accounts for our new hire starting Monday...",
              "We created the AD account and mailbox and assigned the standard licence bundle. Credentials "
              "are handed over by the manager on day one.",
              "en", "IT Support"),
            P("TKT-81570", 0.889, "Lizenz für Software benötigt",
              "Ich benötige eine Lizenz für das Grafikprogramm...",
              "Die Lizenz wurde nach Freigabe durch die Kostenstelle zugewiesen.", "de", "IT Support"),
            P("TKT-79912", 0.876, "Access to shared drive",
              "Need access to the finance share...",
              "Access was granted after approval from the share owner.", "en", "IT Support"),
        ],
        "draft": {
            "en": "Thanks for the request. We will create the account and mailbox and assign the standard "
                  "licence bundle, as for previous new hires [TKT-80044]. Access to restricted resources needs "
                  "approval from the resource owner first [TKT-79912].",
            "de": "Vielen Dank für Ihre Anfrage. Die Lizenz wird nach Freigabe durch die Kostenstelle "
                  "zugewiesen [TKT-81570]. Bitte lassen Sie uns die Freigabe zukommen.",
        },
    },
    "change": {
        "kw": ["upgrade", "migration", "migrate", "deploy", "firmware", "patch", "maintenance window",
               "wartungsfenster", "aktualisierung", "update planen", "change request", "änderung"],
        "type": "Change", "queue": "Technical Support", "priority": "medium",
        "precedents": [
            P("TKT-90015", 0.897, "Schedule firmware upgrade",
              "We would like to upgrade the switch firmware...",
              "We scheduled the upgrade in the Sunday maintenance window and prepared a rollback image.",
              "en", "Technical Support"),
            P("TKT-91233", 0.884, "Wartungsfenster für Migration",
              "Wir planen die Migration der Datenbank...",
              "Die Migration wurde im Wartungsfenster am Wochenende durchgeführt; ein Backup wurde vorher erstellt.",
              "de", "Technical Support"),
            P("TKT-88710", 0.871, "Patch rollout",
              "Need the monthly patches rolled out...",
              "Patches were rolled out to a pilot group first, then to all devices.", "en", "Technical Support"),
        ],
        "draft": {
            "en": "Thanks for the change request. We will schedule it in the weekend maintenance window with a "
                  "rollback image prepared, as for a previous upgrade [TKT-90015], and roll out to a pilot group "
                  "first [TKT-88710].",
            "de": "Vielen Dank für Ihren Änderungsantrag. Wir planen die Durchführung im Wartungsfenster am "
                  "Wochenende und erstellen vorher ein Backup [TKT-91233].",
        },
    },
    "integration": {
        "kw": ["api", "integration", "webhook", "sync error", "schnittstelle", "token expired", "timeout",
               "crm", "sap"],
        "type": "Problem", "queue": "Product Support", "priority": "medium",
        "precedents": [
            P("TKT-33120", 0.893, "Webhook deliveries failing",
              "Our webhooks have been failing with timeouts...",
              "The receiving endpoint took longer than 10 seconds. We raised the timeout and enabled retries.",
              "en", "Product Support"),
            P("TKT-34408", 0.878, "Schnittstelle zum CRM liefert Fehler",
              "Die Synchronisation mit dem CRM bricht ab...",
              "Das API-Token war abgelaufen. Nach Erneuerung des Tokens lief die Synchronisation wieder.",
              "de", "Product Support"),
            P("TKT-32255", 0.869, "Rate limit errors",
              "Getting 429 errors from the API...",
              "We explained the rate limits and enabled request batching.", "en", "Product Support"),
        ],
        "draft": {
            "en": "Thanks for the report. A matching case was an expired API token; renewing it restored the "
                  "sync [TKT-34408]. If you see timeouts instead, raising the timeout and enabling retries fixed "
                  "it before [TKT-33120].",
            "de": "Danke für Ihre Meldung. In einem gleichen Fall war das API-Token abgelaufen; nach der "
                  "Erneuerung lief die Synchronisation wieder [TKT-34408].",
        },
    },
    "product_question": {
        "kw": ["how do i", "how can i", "wie kann ich", "feature", "funktion", "export", "pricing", "preis",
               "demo", "trial", "question", "frage"],
        "type": "Request", "queue": "Product Support", "priority": "low",
        "precedents": [
            P("TKT-12001", 0.896, "How to export reports",
              "How can I export the monthly report as CSV?",
              "Open Reports, choose the report and click Export > CSV. Scheduled exports are under Settings.",
              "en", "Product Support"),
            P("TKT-12544", 0.882, "Export als Excel",
              "Wie kann ich Berichte als Excel exportieren?",
              "Unter Berichte > Export können Sie das Format Excel wählen.", "de", "Product Support"),
            P("TKT-11873", 0.870, "Pricing tiers",
              "What is included in the business tier?",
              "Our sales team sent the current tier overview.", "en", "Sales and Pre-Sales"),
        ],
        "draft": {
            "en": "Thanks for your question. Open Reports, choose the report and click Export > CSV; scheduled "
                  "exports are under Settings [TKT-12001].",
            "de": "Vielen Dank für Ihre Frage. Unter Berichte > Export können Sie das gewünschte Format wählen "
                  "[TKT-12544].",
        },
    },
    "returns": {
        "kw": ["return", "rücksendung", "exchange", "umtausch", "defective", "defekt", "shipping", "lieferung",
               "delivery", "warranty"],
        "type": "Request", "queue": "Returns and Exchanges", "priority": "low",
        "precedents": [
            P("TKT-44020", 0.899, "Return defective headset",
              "The headset arrived with a broken mic...",
              "We issued an RMA label; once the device arrives we ship a replacement.", "en",
              "Returns and Exchanges"),
            P("TKT-44871", 0.885, "Gerät defekt geliefert",
              "Das Gerät kam defekt an...",
              "Wir haben ein Rücksendeetikett ausgestellt; nach Eingang senden wir Ersatz.", "de",
              "Returns and Exchanges"),
            P("TKT-43310", 0.871, "Delivery delayed", "Order not arrived...",
              "The carrier delayed the parcel; tracking was updated.", "en", "Returns and Exchanges"),
        ],
        "draft": {
            "en": "Sorry the device arrived damaged. We will issue an RMA label and ship a replacement once the "
                  "device arrives [TKT-44020].",
            "de": "Es tut uns leid, dass das Gerät defekt ankam. Wir stellen ein Rücksendeetikett aus und "
                  "senden nach Eingang Ersatz [TKT-44871].",
        },
    },
}

GENERIC_PRECEDENTS = [
    P("TKT-00412", 0.851, "General question", "We have a question about our account...",
      "Thank you, we forwarded your question to the responsible team.", "en", "General Inquiry"),
    P("TKT-00877", 0.842, "Allgemeine Anfrage", "Wir haben eine Frage...",
      "Vielen Dank, wir haben Ihre Anfrage weitergeleitet.", "de", "General Inquiry"),
    P("TKT-00933", 0.836, "Misc", "Hello team...", "We will get back to you.", "en", "Customer Service"),
]

_DE_WORDS = re.compile(r"\b(der|die|das|und|ist|nicht|wir|ich|sie|bitte|mit|seit|unser|unsere|für|auf|"
                       r"eine?|kann|werden|wurde|keine?|danke|hallo|sehr|geehrte)\b|[äöüß]", re.I)
_URGENT = re.compile(r"\b(urgent|asap|immediately|critical|emergency|patients?|all users|down|"
                     r"dringend|sofort|kritisch|notfall|alle)\b", re.I)
_LOW = re.compile(r"\b(no rush|when you get a chance|not urgent|low priority|keine eile|nicht dringend)\b", re.I)


def _h(text: str, salt: str = "") -> float:
    """Deterministic 0..1 jitter from the text."""
    return int(hashlib.md5((salt + text).encode("utf-8", "ignore")).hexdigest()[:8], 16) / 0xFFFFFFFF


def detect_language(text: str) -> tuple[str, float]:
    words = max(1, len(re.findall(r"\w+", text)))
    de = len(_DE_WORDS.findall(text))
    ratio = de / words
    if ratio > 0.08:
        return "de", min(0.99, 0.75 + ratio)
    return "en", min(0.99, 0.80 + (0.1 - min(ratio, 0.1)) * 1.9)


def match_topic(text: str) -> tuple[str | None, int]:
    t = text.lower()
    best, hits = None, 0
    for name, topic in TOPICS.items():
        n = sum(1 for k in topic["kw"] if k in t)
        if n > hits:
            best, hits = name, n
    return best, hits


def _probs(label: str, conf: float, labels: list[str]) -> dict[str, float]:
    others = [l for l in labels if l != label]
    rest = 1 - conf
    out = {label: round(conf, 4)}
    for i, l in enumerate(others):
        share = rest * (0.6 if i == 0 else 0.4 / max(1, len(others) - 1))
        out[l] = round(share, 4)
    return out


# ---- mock burst detector (topic + 30 min window, mirrors BurstDetector's return shape) ----
class MockBurst:
    def __init__(self):
        self._recent: deque[tuple[str, float, str]] = deque(maxlen=500)
        self._n = 0

    def check(self, topic: str | None, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        self._n += 1
        live_id = f"NEW-{self._n:04d}"
        while self._recent and now - self._recent[0][1] > config.BURST_WINDOW_S:
            self._recent.popleft()
        related = [lid for (tp, _, lid) in self._recent if topic and tp == topic]
        if topic and TOPICS.get(topic, {}).get("burst"):
            self._recent.append((topic, now, live_id))
        max_sim = 0.91 if related else 0.0
        return {"active": len(related) + 1 >= config.BURST_MIN_COUNT, "related": related,
                "live_id": live_id, "max_sim": max_sim}


BURST = MockBurst()


def mock_triage(subject: str | None, body: str | None, now: float | None = None,
                track_burst: bool = True) -> TriageResult:
    t0 = time.perf_counter()
    text = build_text(subject, body)
    masked_text, masked = pii.mask(text)
    lang, lang_conf = detect_language(text)
    topic_name, hits = match_topic(text)
    topic = TOPICS.get(topic_name) if topic_name else None
    j = _h(text)

    if topic:
        type_label, queue_label, prio_label = topic["type"], topic["queue"], topic["priority"]
        strength = min(1.0, 0.55 + 0.2 * hits)
        type_conf = 0.74 + 0.22 * strength * (0.6 + 0.4 * j)
        queue_conf = 0.46 + 0.40 * strength * (0.5 + 0.5 * _h(text, "q"))
        prio_conf = 0.66 + 0.28 * strength * (0.5 + 0.5 * _h(text, "p"))
        precedents = [Precedent(**{**p, "score": round(p["score"] - 0.012 * (1 - strength) - 0.01 * j, 4)})
                      for p in topic["precedents"]]
    else:
        type_label, queue_label, prio_label = "Request", "General Inquiry", "medium"
        type_conf, queue_conf, prio_conf = 0.55 + 0.2 * j, 0.31 + 0.15 * j, 0.52 + 0.15 * j
        precedents = [Precedent(**p) for p in GENERIC_PRECEDENTS]

    if _URGENT.search(text) and prio_label != "high" and type_label == "Incident":
        prio_label, prio_conf = "high", max(prio_conf, 0.72)
    if _LOW.search(text):
        prio_label, prio_conf = "low", max(prio_conf, 0.74)

    type_ = Prediction(type_label, round(type_conf, 4),
                       _probs(type_label, type_conf, ["Incident", "Request", "Problem", "Change"]))
    queue = Prediction(queue_label, round(queue_conf, 4), _probs(queue_label, queue_conf, QUEUES[:4]))
    priority = Prediction(prio_label, round(prio_conf, 4),
                          _probs(prio_label, prio_conf, ["high", "medium", "low"]))
    language = Prediction(lang, round(lang_conf, 4), _probs(lang, lang_conf, ["en", "de"]))

    burst = BURST.check(topic_name, now) if track_burst else \
        {"active": False, "related": [], "live_id": None, "max_sim": 0.0}
    escalate, reasons = gate.evaluate(text, type_, queue, priority, precedents, None, burst)

    latency = {"embed": round(9 + 6 * j, 1), "classify": round(3 + 3 * _h(text, "c"), 1),
               "retrieve": round(18 + 14 * _h(text, "r"), 1)}
    draft, cited, unverified, engine = None, [], [], None
    if not escalate and topic:
        draft = topic["draft"][lang]
        cited = list(dict.fromkeys(re.findall(r"TKT-\d{5}", draft)))
        unverified = unsupported_figures(draft, " ".join(p.answer for p in precedents))
        engine = "mock-llm"
        latency["generate"] = round(700 + 600 * _h(text, "g"), 1)
    else:
        latency["generate"] = 0.0
    latency["total"] = round(sum(latency.values()) + (time.perf_counter() - t0) * 1000, 1)

    return TriageResult(
        language=lang, type=type_, queue=queue, priority=priority,
        escalate=escalate, escalation_reasons=reasons, precedents=precedents,
        draft_reply=draft, cited_ticket_ids=cited, unverified_claims=unverified,
        masked_pii=masked, latency_ms=latency, risks=gate.detect_risks(text), burst=burst,
        engine=engine,
    )


def masked(text: str) -> str:
    return pii.mask(text or "")[0]


def suggestion(text: str, lang: str) -> str | None:
    """Template resolution for the copilot card on escalated tickets (mock only)."""
    name, _ = match_topic(text)
    return TOPICS[name]["draft"][lang] if name else None
