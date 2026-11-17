-- 私有桶读取保留上传时的配置与加密凭据，切换图床或停用后已有图片仍可读。
ALTER TABLE image_host_objects ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE image_host_objects ADD COLUMN ciphertext TEXT NOT NULL DEFAULT '';
