-- API Key 可再次复制：用服务端加密密钥保存完整 Key，旧 Key 只有哈希，无法找回。
ALTER TABLE api_keys ADD COLUMN key_encrypted TEXT;
