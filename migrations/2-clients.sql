INSERT INTO clients (id, name, active, created_at, updated_at) VALUES
('8cd17657-0a33-4c8d-81b2-5586ce8d770e', 'PMG', true, '2026-01-06 07:34:47', '2026-01-06 07:34:47')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;
