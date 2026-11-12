from dataclasses import dataclass, field


@dataclass(frozen=True)
class ModelConfig:
    enabled: bool = False
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    timeout_seconds: int = 45


@dataclass(frozen=True)
class SearchConfig:
    provider: str = "public"
    base_url: str = ""
    api_key: str = ""


@dataclass(frozen=True)
class TelephonyConfig:
    enabled: bool = False
    provider: str = ""
    base_url: str = ""
    api_key: str = ""
    sip_domain: str = ""
    sip_username: str = ""
    sip_password: str = ""
    caller_id: str = ""
    tts_provider: str = ""
    tts_model: str = ""
    voice_id: str = ""
    asr_base_url: str = ""
    asr_model: str = ""
    asr_api_key: str = ""
    realtime_model: str = ""
    bridge_url: str = ""
    bridge_token: str = ""
    server_ip: str = ""
    port: int = 5060
    transport: str = "udp"
    prefix: str = ""
    concurrency: int = 1
    calls_per_second: int = 1
    live_enabled: bool = False
    whitelist_confirmed: bool = False
    aliyun_access_key_id: str = ""
    aliyun_access_key_secret: str = ""
    aliyun_region: str = "cn-shanghai"
    aliyun_application_code: str = ""
    aliyun_caller_number: str = ""
    aliyun_gateway_token: str = ""
    aliyun_receipt_token: str = ""


@dataclass(frozen=True)
class MailConfig:
    provider: str = "smtp"
    host: str = ""
    port: int = 465
    secure: bool = True
    username: str = ""
    password: str = ""
    from_address: str = ""
    from_name: str = ""
    imap_host: str = ""
    imap_port: int = 993
    imap_secure: bool = True


@dataclass(frozen=True)
class WhatsAppConfig:
    provider: str = ""
    base_url: str = ""
    api_key: str = ""
    phone_number_id: str = ""
    verify_token: str = ""
    app_secret: str = ""


@dataclass(frozen=True)
class CRMConfig:
    provider: str = ""
    base_url: str = ""
    api_key: str = ""


@dataclass(frozen=True)
class WeComConfig:
    corp_id: str = ""
    agent_id: str = ""
    corp_secret: str = ""
    token: str = ""
    encoding_aes_key: str = ""
    webhook_url: str = ""


@dataclass(frozen=True)
class NotificationConfig:
    webhook_url: str = ""


@dataclass(frozen=True)
class Integrations:
    model: ModelConfig = field(default_factory=ModelConfig)
    search: SearchConfig = field(default_factory=SearchConfig)
    telephony: TelephonyConfig = field(default_factory=TelephonyConfig)
    notifications: NotificationConfig = field(default_factory=NotificationConfig)
    mail: MailConfig = field(default_factory=MailConfig)
    whatsapp: WhatsAppConfig = field(default_factory=WhatsAppConfig)
    crm: CRMConfig = field(default_factory=CRMConfig)
    wecom: WeComConfig = field(default_factory=WeComConfig)
