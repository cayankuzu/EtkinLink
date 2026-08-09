begin;

insert into public.interests (slug, label, sort_order, is_active)
values
  ('canli-muzik', 'Canlı Müzik', 10, true),
  ('konser', 'Konser', 20, true),
  ('festival', 'Festival', 30, true),
  ('elektronik-muzik', 'Elektronik Müzik', 40, true),
  ('klasik-muzik', 'Klasik Müzik', 50, true),
  ('tiyatro', 'Tiyatro', 60, true),
  ('stand-up', 'Stand-up', 70, true),
  ('sinema', 'Sinema', 80, true),
  ('sergi', 'Sergi', 90, true),
  ('muze', 'Müze', 100, true),
  ('tasarim', 'Tasarım', 110, true),
  ('fotograf', 'Fotoğraf', 120, true),
  ('mimari', 'Mimari', 130, true),
  ('edebiyat', 'Edebiyat', 140, true),
  ('kitap', 'Kitap', 150, true),
  ('soylesi', 'Söyleşi', 160, true),
  ('atolye', 'Atölye', 170, true),
  ('el-sanatlari', 'El Sanatları', 180, true),
  ('teknoloji', 'Teknoloji', 190, true),
  ('bilim', 'Bilim', 200, true),
  ('girisimcilik', 'Girişimcilik', 210, true),
  ('networking', 'Networking', 220, true),
  ('egitim', 'Eğitim', 230, true),
  ('oyun', 'Oyun', 240, true),
  ('spor', 'Spor', 250, true),
  ('doga', 'Doğa', 260, true),
  ('seyahat', 'Seyahat', 270, true),
  ('dans', 'Dans', 280, true),
  ('yoga', 'Yoga', 290, true),
  ('wellness', 'Wellness', 300, true),
  ('gastronomi', 'Gastronomi', 310, true),
  ('kahve', 'Kahve', 320, true),
  ('gonulluluk', 'Gönüllülük', 330, true),
  ('tarih', 'Tarih', 340, true)
on conflict (slug) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

commit;
