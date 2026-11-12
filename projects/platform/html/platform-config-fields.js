/** @typedef {{key: string, label: string, type?: 'secret'|'number'|'checkbox', max?: number}} Field */
/** @type {Record<string, {title: string, fields: Field[]}>} */
export const sections = {
  model: { title: '大模型', fields: [
    {key:'enabled',label:'启用模型',type:'checkbox'}, {key:'base_url',label:'API 地址'},
    {key:'model',label:'模型名称'}, {key:'api_key',label:'API 密钥',type:'secret'},
    {key:'timeout_seconds',label:'请求超时（秒）',type:'number',max:120},
  ]},
  search: { title: '搜索服务', fields: [
    {key:'provider',label:'服务类型'}, {key:'base_url',label:'接口地址'}, {key:'api_key',label:'API 密钥',type:'secret'},
  ]},
  telephony: { title: '电话线路与语音', fields: [
    {key:'enabled',label:'启用电话服务',type:'checkbox'}, {key:'provider',label:'服务类型'},
    {key:'base_url',label:'服务接口地址'}, {key:'api_key',label:'服务密钥',type:'secret'},
    {key:'bridge_url',label:'语音桥地址'}, {key:'bridge_token',label:'语音桥令牌',type:'secret'},
    {key:'sip_domain',label:'SIP 域'}, {key:'sip_username',label:'SIP 用户名'}, {key:'sip_password',label:'SIP 密码',type:'secret'},
    {key:'server_ip',label:'SIP 服务器'}, {key:'port',label:'SIP 端口',type:'number',max:65535},
    {key:'transport',label:'传输协议'}, {key:'caller_id',label:'主叫号码'}, {key:'prefix',label:'拨号前缀'},
    {key:'concurrency',label:'并发通话数',type:'number',max:1000}, {key:'calls_per_second',label:'每秒呼叫数',type:'number',max:1000},
    {key:'live_enabled',label:'启用真实拨号',type:'checkbox'}, {key:'whitelist_confirmed',label:'已确认线路白名单',type:'checkbox'},
    {key:'tts_provider',label:'语音合成服务'}, {key:'tts_model',label:'语音合成模型'}, {key:'voice_id',label:'默认声音'},
    {key:'asr_base_url',label:'语音识别地址'}, {key:'asr_model',label:'语音识别模型'},
    {key:'asr_api_key',label:'语音识别密钥',type:'secret'}, {key:'realtime_model',label:'实时通话模型'},
    {key:'aliyun_access_key_id',label:'阿里云 AccessKey ID'}, {key:'aliyun_access_key_secret',label:'阿里云 AccessKey Secret',type:'secret'},
    {key:'aliyun_region',label:'阿里云地域'}, {key:'aliyun_application_code',label:'阿里云应用编号'},
    {key:'aliyun_caller_number',label:'阿里云主叫号码'}, {key:'aliyun_gateway_token',label:'阿里云网关令牌',type:'secret'},
    {key:'aliyun_receipt_token',label:'阿里云回执令牌',type:'secret'},
  ]},
  mail: { title: '邮箱', fields: [
    {key:'provider',label:'服务类型'}, {key:'host',label:'SMTP 服务器'}, {key:'port',label:'SMTP 端口',type:'number',max:65535},
    {key:'secure',label:'SMTP 使用 TLS',type:'checkbox'}, {key:'username',label:'邮箱账号'}, {key:'password',label:'邮箱授权码或密码',type:'secret'},
    {key:'from_address',label:'发件地址'}, {key:'from_name',label:'发件名称'}, {key:'imap_host',label:'IMAP 服务器'},
    {key:'imap_port',label:'IMAP 端口',type:'number',max:65535}, {key:'imap_secure',label:'IMAP 使用 TLS',type:'checkbox'},
  ]},
  whatsapp: { title: 'WhatsApp', fields: [
    {key:'provider',label:'服务类型（browser / http / meta）'}, {key:'base_url',label:'接口地址'}, {key:'api_key',label:'API 密钥',type:'secret'},
    {key:'phone_number_id',label:'电话号码编号'}, {key:'verify_token',label:'回调验证令牌',type:'secret'}, {key:'app_secret',label:'应用密钥',type:'secret'},
  ]},
  wecom: { title: '企业微信', fields: [
    {key:'corp_id',label:'企业编号'}, {key:'agent_id',label:'应用编号'}, {key:'corp_secret',label:'应用密钥',type:'secret'},
    {key:'token',label:'回调令牌',type:'secret'}, {key:'encoding_aes_key',label:'回调加密密钥',type:'secret'}, {key:'webhook_url',label:'群机器人地址'},
  ]},
  crm: { title: 'CRM', fields: [
    {key:'provider',label:'服务类型'}, {key:'base_url',label:'接口地址'}, {key:'api_key',label:'API 密钥',type:'secret'},
  ]},
  notifications: { title: '线索通知', fields: [{key:'webhook_url',label:'Webhook 地址'}]},
};
