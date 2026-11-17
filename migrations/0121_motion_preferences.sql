-- 界面动效偏好：默认启用标准动效，可在设置中整体关闭或逐项调整。
-- 系统开启“减少动态效果”时前端仍会自动降级，不受这些默认值影响。
ALTER TABLE user_preferences ADD COLUMN motion_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN motion_speed INTEGER NOT NULL DEFAULT 100 CHECK (motion_speed BETWEEN 50 AND 200);
ALTER TABLE user_preferences ADD COLUMN motion_intensity TEXT NOT NULL DEFAULT 'standard' CHECK (motion_intensity IN ('subtle', 'standard', 'lively'));
ALTER TABLE user_preferences ADD COLUMN motion_button_feedback INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN motion_card_hover TEXT NOT NULL DEFAULT 'lift' CHECK (motion_card_hover IN ('none', 'lift', 'tilt', 'glow'));
ALTER TABLE user_preferences ADD COLUMN motion_list_entrance TEXT NOT NULL DEFAULT 'rise' CHECK (motion_list_entrance IN ('none', 'fade', 'rise', 'scale'));
ALTER TABLE user_preferences ADD COLUMN motion_tag_linkage INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN motion_page_transition INTEGER NOT NULL DEFAULT 1;
