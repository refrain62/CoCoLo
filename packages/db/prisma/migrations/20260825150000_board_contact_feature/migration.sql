-- 役員・連絡先をチーム単位の無料featureとしてAPIとWebの契約へ登録する。
INSERT INTO feature_definitions (key, billing_type, display_name, default_enabled)
VALUES ('board-contacts', 'free', '役員・連絡先', true)
ON CONFLICT (key) DO NOTHING;
