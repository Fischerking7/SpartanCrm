INSERT INTO providers (id, name, active, created_at, updated_at) VALUES
('88a9321e-d805-4543-9e77-2116890d471b', 'Astound', true, '2026-01-06 07:34:34', '2026-01-06 07:34:34')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO providers (id, name, active, created_at, updated_at) VALUES
('212025c9-50f6-4828-a3d3-102f320bbee9', 'Optimum', true, '2026-01-06 07:34:39', '2026-01-06 07:34:39')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;
