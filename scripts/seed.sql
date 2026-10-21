-- Demo tenant and fleet. The API key is the one in wrangler.jsonc's vars; its hash is here.
INSERT OR IGNORE INTO tenants (id, name, api_key_hash, payment_secret, created_at)
VALUES ('ten_demo', 'Harbour Studio', '9686284a1804f7bed5befc9473c3dcdec5cb5b6d5cf7db6a0dd0bbed46bc57a3', 'whsec_demo_2026', '2026-10-01T09:00:00Z');

INSERT OR IGNORE INTO resources (id, tenant_id, name, timezone, slot_minutes, capacity, created_at) VALUES
  ('res_room_a', 'ten_demo', 'Room A — recording', 'Europe/Istanbul', 60, 1, '2026-10-01T09:00:00Z'),
  ('res_room_b', 'ten_demo', 'Room B — rehearsal', 'Europe/Istanbul', 30, 1, '2026-10-01T09:00:00Z'),
  ('res_class',  'ten_demo', 'Mixing class',       'Europe/London',   90, 6, '2026-10-01T09:00:00Z');

-- Weekdays 09:00–18:00 for the rooms; the class runs Tuesday and Thursday evenings.
INSERT OR IGNORE INTO availability_rules (id, resource_id, weekday, start_minute, end_minute) VALUES
  ('rule_a1', 'res_room_a', 1, 540, 1080), ('rule_a2', 'res_room_a', 2, 540, 1080), ('rule_a3', 'res_room_a', 3, 540, 1080),
  ('rule_a4', 'res_room_a', 4, 540, 1080), ('rule_a5', 'res_room_a', 5, 540, 1080),
  ('rule_b1', 'res_room_b', 1, 600, 1320), ('rule_b2', 'res_room_b', 2, 600, 1320), ('rule_b3', 'res_room_b', 3, 600, 1320),
  ('rule_b4', 'res_room_b', 4, 600, 1320), ('rule_b5', 'res_room_b', 5, 600, 1320), ('rule_b6', 'res_room_b', 6, 600, 960),
  ('rule_c2', 'res_class', 2, 1080, 1260), ('rule_c4', 'res_class', 4, 1080, 1260);

-- A few bookings on the next few days, so the calendar is not empty on arrival.
INSERT OR IGNORE INTO bookings (id, tenant_id, resource_id, starts_at, ends_at, status, hold_expires_at, customer_name, customer_email, notes, created_at, updated_at) VALUES
  ('bkg_seed_1', 'ten_demo', 'res_room_a', '2026-10-23T07:00:00Z', '2026-10-23T09:00:00Z', 'confirmed', NULL, 'Deniz Aksoy', 'deniz@example.com', 'Vocal session', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z'),
  ('bkg_seed_2', 'ten_demo', 'res_room_a', '2026-10-23T12:00:00Z', '2026-10-23T13:00:00Z', 'confirmed', NULL, 'Mara Lind', 'mara@example.com', NULL, '2026-10-20T11:00:00Z', '2026-10-20T11:00:00Z'),
  ('bkg_seed_3', 'ten_demo', 'res_room_b', '2026-10-23T08:30:00Z', '2026-10-23T09:30:00Z', 'confirmed', NULL, 'The Quays', 'band@example.com', 'Rehearsal', '2026-10-21T09:00:00Z', '2026-10-21T09:00:00Z'),
  ('bkg_seed_4', 'ten_demo', 'res_class',  '2026-10-22T17:00:00Z', '2026-10-22T18:30:00Z', 'confirmed', NULL, 'Ola Berg', 'ola@example.com', NULL, '2026-10-21T09:00:00Z', '2026-10-21T09:00:00Z'),
  ('bkg_seed_5', 'ten_demo', 'res_class',  '2026-10-22T17:00:00Z', '2026-10-22T18:30:00Z', 'confirmed', NULL, 'Sam Reyes', 'sam@example.com', NULL, '2026-10-21T09:05:00Z', '2026-10-21T09:05:00Z');
