-- SQL script to copy development data to production
-- Run this in the Production Database panel
-- WARNING: This will insert data. Run only once!

-- Step 1: Insert Providers
INSERT INTO providers (id, name, active, created_at, updated_at) VALUES
('88a9321e-d805-4543-9e77-2116890d471b', 'Astound', true, '2026-01-06 07:34:34.080949', '2026-01-06 07:34:34.080949'),
('212025c9-50f6-4828-a3d3-102f320bbee9', 'Optimum', true, '2026-01-06 07:34:39.879701', '2026-01-06 07:34:39.879701')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;

-- Step 2: Insert Clients
INSERT INTO clients (id, name, active, created_at, updated_at) VALUES
('8cd17657-0a33-4c8d-81b2-5586ce8d770e', 'PMG', true, '2026-01-06 07:34:47.094097', '2026-01-06 07:34:47.094097')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;

-- Step 3: Insert Services
INSERT INTO services (id, code, name, category, unit_type, active, created_at, updated_at) VALUES
('5922d7d1-336d-4209-aac0-92941994e6c9', '150_MBPS', '150 MBPS', 'Internet', 'Speed', true, '2026-01-06 19:49:13.316895', '2026-01-06 19:49:37.978'),
('57f47c58-21b0-4ce2-bc1a-528cc668cc10', '50_MBPS', '50 MBPS', 'Internet', 'Speed', true, '2026-01-06 19:48:26.114856', '2026-01-06 19:49:43.615'),
('2de3acb5-8c57-4680-977a-32783eb66dd6', '5_GIG', '5 Gig', 'Internet', 'Speed', true, '2026-01-06 07:48:20.644368', '2026-01-06 19:49:50.743'),
('22f0a223-6306-43a0-aaea-2d3143921735', '2_GIG', '2 Gig', 'Internet', 'Speed', true, '2026-01-06 07:48:20.644368', '2026-01-06 19:49:58.125'),
('2beb75b6-d64a-4a28-957b-e1d854afb4f4', '1_GIG', '1 Gig', 'Internet', 'Speed', true, '2026-01-06 07:46:07.327303', '2026-01-06 19:50:07.139'),
('158b569d-52cc-42b3-b74e-283cc779a69d', '600_MBPS', '600 MPBS', 'Internet', 'Speed', true, '2026-01-06 19:50:32.96225', '2026-01-06 19:50:32.96225'),
('ba872cf2-e7dc-4d93-b9d6-fbc8d3ffd24a', '300_MBPS', '300 MBPS', 'Internet', 'Speed', true, '2026-01-06 19:51:22.678749', '2026-01-06 19:51:22.678749'),
('f96671c3-061c-4a45-9bea-fe7d1ff7b2b1', 'Multi-Gig', 'Multi-Gig', 'Internet', 'Speed', true, '2026-01-06 22:03:03.030545', '2026-01-06 22:03:03.030545'),
('7a1a8522-e76a-4bea-9012-9848fbda1265', 'Gen Internet', 'Gen Internet', 'Internet', 'Speed', true, '2026-01-06 22:03:30.916728', '2026-01-06 22:03:30.916728'),
('3285ddf1-5bd3-48cf-8d45-6b2eaef5841f', 'GiG_PLUS', 'GIG+', 'Internet', 'Speed', true, '2026-01-07 01:31:08.214316', '2026-01-07 01:31:08.214316')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, category = EXCLUDED.category, unit_type = EXCLUDED.unit_type, active = EXCLUDED.active;

-- Step 4: Insert Rate Cards
INSERT INTO rate_cards (id, provider_id, client_id, service_id, effective_start, active, base_amount, tv_addon_amount, mobile_per_line_amount, mobile_product_type, mobile_ported_status, override_deduction, tv_override_deduction, mobile_override_deduction, created_at, updated_at) VALUES
('c56c5242-1a68-4133-8990-8dfac8625aed', '212025c9-50f6-4828-a3d3-102f320bbee9', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', '7a1a8522-e76a-4bea-9012-9848fbda1265', '2026-01-01', true, 350.00, 40.00, 0.00, NULL, NULL, 125.00, 20.00, 0.00, '2026-01-07 02:53:37.255758', '2026-01-07 06:47:31.356'),
('5be35b08-66e1-446b-877b-195c99b70a58', '88a9321e-d805-4543-9e77-2116890d471b', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', '2beb75b6-d64a-4a28-957b-e1d854afb4f4', '2026-01-01', true, 350.00, 80.00, 0.00, NULL, NULL, 125.00, 40.00, 0.00, '2026-01-07 02:42:50.308719', '2026-01-07 06:47:53.277'),
('00fcd9f2-7a03-4ca9-b74c-c8321c5d1423', '88a9321e-d805-4543-9e77-2116890d471b', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', NULL, '2026-01-01', true, 0.00, 0.00, 30.00, '3_GIG', NULL, 0.00, 0.00, 0.00, '2026-01-07 02:39:15.462114', '2026-01-07 02:39:15.462114'),
('98fa5888-e2a1-4407-8767-64b25e32a872', '88a9321e-d805-4543-9e77-2116890d471b', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', '158b569d-52cc-42b3-b74e-283cc779a69d', '2026-01-01', true, 285.00, 80.00, 0.00, NULL, NULL, 125.00, 40.00, 0.00, '2026-01-07 02:42:16.936857', '2026-01-07 06:48:21.547'),
('a2064308-3f12-460d-80b5-9a6252aa2b03', '88a9321e-d805-4543-9e77-2116890d471b', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', NULL, '2026-01-01', true, 0.00, 0.00, 15.00, '1_GIG', NULL, 0.00, 0.00, 0.00, '2026-01-07 02:40:51.550375', '2026-01-07 06:51:44.415'),
('364b52c3-18b6-4165-af91-97e613b06f09', '88a9321e-d805-4543-9e77-2116890d471b', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', '57f47c58-21b0-4ce2-bc1a-528cc668cc10', '2026-01-01', true, 95.00, 80.00, 0.00, NULL, NULL, 75.00, 40.00, 0.00, '2026-01-07 01:34:10.244375', '2026-01-07 06:52:36.267'),
('63fd4a12-ecea-4324-93a0-99a4227e90da', '212025c9-50f6-4828-a3d3-102f320bbee9', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', NULL, '2026-01-01', true, 0.00, 0.00, 55.00, NULL, 'NON_PORTED', 0.00, 0.00, 55.00, '2026-01-06 21:20:18.455598', '2026-01-07 06:53:08.386'),
('2ec857a4-788c-408e-b06a-ce9644be5821', '212025c9-50f6-4828-a3d3-102f320bbee9', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', NULL, '2026-01-01', true, 0.00, 0.00, 130.00, NULL, 'PORTED', 50.00, 0.00, 0.00, '2026-01-06 21:19:36.145953', '2026-01-07 06:53:27.326'),
('f9be96a0-b613-413c-84c8-3a871a24129a', '88a9321e-d805-4543-9e77-2116890d471b', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', '3285ddf1-5bd3-48cf-8d45-6b2eaef5841f', '2026-01-01', true, 390.00, 80.00, 0.00, NULL, NULL, 135.00, 40.00, 0.00, '2026-01-07 02:52:25.760595', '2026-01-07 06:41:59.572'),
('b0b02a1b-221a-43a3-87fe-61ac3c6facdf', '88a9321e-d805-4543-9e77-2116890d471b', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', '5922d7d1-336d-4209-aac0-92941994e6c9', '2026-01-01', true, 190.00, 80.00, 0.00, NULL, NULL, 100.00, 40.00, 0.00, '2026-01-07 02:34:32.07901', '2026-01-07 06:54:04.933'),
('8bd9ddaf-eddc-4206-a822-d6bff1f3f449', '88a9321e-d805-4543-9e77-2116890d471b', '8cd17657-0a33-4c8d-81b2-5586ce8d770e', 'ba872cf2-e7dc-4d93-b9d6-fbc8d3ffd24a', '2026-01-01', true, 255.00, 80.00, 0.00, NULL, NULL, 125.00, 40.00, 0.00, '2026-01-07 02:41:47.621943', '2026-01-07 06:54:17.728')
ON CONFLICT (id) DO UPDATE SET 
  provider_id = EXCLUDED.provider_id,
  client_id = EXCLUDED.client_id,
  service_id = EXCLUDED.service_id,
  base_amount = EXCLUDED.base_amount,
  tv_addon_amount = EXCLUDED.tv_addon_amount,
  mobile_per_line_amount = EXCLUDED.mobile_per_line_amount,
  mobile_product_type = EXCLUDED.mobile_product_type,
  mobile_ported_status = EXCLUDED.mobile_ported_status,
  override_deduction = EXCLUDED.override_deduction,
  tv_override_deduction = EXCLUDED.tv_override_deduction,
  mobile_override_deduction = EXCLUDED.mobile_override_deduction,
  active = EXCLUDED.active;

-- Done! Verify with:
-- SELECT COUNT(*) FROM providers;
-- SELECT COUNT(*) FROM clients;
-- SELECT COUNT(*) FROM services;
-- SELECT COUNT(*) FROM rate_cards WHERE active = true;
