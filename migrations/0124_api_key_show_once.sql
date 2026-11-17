-- 恢复 API Key 仅创建时展示：清除旧版密文，保留哈希、前缀和权限，现有 Key 继续有效。
UPDATE api_keys SET key_encrypted = NULL WHERE key_encrypted IS NOT NULL;
