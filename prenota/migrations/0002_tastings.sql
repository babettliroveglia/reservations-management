-- The four tastings and starting settings, from tenutaroveglia.com/visite/ (November 2026).
-- Staff can change capacity and times in the admin; tastings are changed with a new migration.

INSERT INTO tastings (id, name, description, duration_min, price_adult_cents, teen_discount_pct, min_adults, max_adults, sort) VALUES
  ('benvenuto', 'Percorso di Benvenuto',
   'Degustazione di 3 vini: Lugana Limne, San Martino della Battaglia Vitis Alba, Merlot Garda DOC. Accompagnati da grissini e taralli.',
   90, 2500, 50, 1, 10, 1),
  ('conoscenza', 'Percorso di Conoscenza',
   'Degustazione di 4 vini: Lugana Vigne di Catullo, Lugana Filo di Arianna, San Martino della Battaglia Vitis Alba, Ruvus Garda DOC. Accompagnati da un tagliere di salumi e formaggi.',
   120, 3800, 50, 1, 10, 2),
  ('sfumature-limne', 'Sfumature di Limne',
   'Degustazione verticale di tre annate storiche, insieme all''annata corrente di Lugana Limne. Accompagnati da una selezione di salumi e formaggi.',
   150, 6000, NULL, 4, 8, 3),   -- the website gives no 13–17 price: adults only until confirmed
  ('sfumature-catullo', 'Sfumature di Catullo',
   'Degustazione verticale di tre annate storiche, insieme all''annata corrente di Lugana Riserva Vigne di Catullo. Accompagnati da una selezione di salumi e formaggi.',
   150, 8000, NULL, 4, 8, 4);   -- likewise

INSERT INTO settings (key, value) VALUES
  ('slot_times', '10:30,15:00'),   -- tasting start times
  ('slot_capacity', '20'),         -- guests per start time, all tastings together (placeholder)
  ('horizon_days', '180');         -- how far ahead guests can book
