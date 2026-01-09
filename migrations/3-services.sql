INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('5922d7d1-336d-4209-aac0-92941994e6c9', '150_MBPS', '150 MBPS', 'Internet', 'Speed', true, '2026-01-06 19:49:13', '2026-01-06 19:49:37')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('57f47c58-21b0-4ce2-bc1a-528cc668cc10', '50_MBPS', '50 MBPS', 'Internet', 'Speed', true, '2026-01-06 19:48:26', '2026-01-06 19:49:43')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('2de3acb5-8c57-4680-977a-32783eb66dd6', '5_GIG', '5 Gig', 'Internet', 'Speed', true, '2026-01-06 07:48:20', '2026-01-06 19:49:50')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('22f0a223-6306-43a0-aaea-2d3143921735', '2_GIG', '2 Gig', 'Internet', 'Speed', true, '2026-01-06 07:48:20', '2026-01-06 19:49:58')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('2beb75b6-d64a-4a28-957b-e1d854afb4f4', '1_GIG', '1 Gig', 'Internet', 'Speed', true, '2026-01-06 07:46:07', '2026-01-06 19:50:07')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('158b569d-52cc-42b3-b74e-283cc779a69d', '600_MBPS', '600 MPBS', 'Internet', 'Speed', true, '2026-01-06 19:50:32', '2026-01-06 19:50:32')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('ba872cf2-e7dc-4d93-b9d6-fbc8d3ffd24a', '300_MBPS', '300 MBPS', 'Internet', 'Speed', true, '2026-01-06 19:51:22', '2026-01-06 19:51:22')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('f96671c3-061c-4a45-9bea-fe7d1ff7b2b1', 'Multi-Gig', 'Multi-Gig', 'Internet', 'Speed', true, '2026-01-06 22:03:03', '2026-01-06 22:03:03')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('7a1a8522-e76a-4bea-9012-9848fbda1265', 'Gen Internet', 'Gen Internet', 'Internet', 'Speed', true, '2026-01-06 22:03:30', '2026-01-06 22:03:30')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;

INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('3285ddf1-5bd3-48cf-8d45-6b2eaef5841f', 'GiG_PLUS', 'GIG+', 'Internet', 'Speed', true, '2026-01-07 01:31:08', '2026-01-07 01:31:08')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, active = EXCLUDED.active;
