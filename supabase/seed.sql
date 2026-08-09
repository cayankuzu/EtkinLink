insert into public.cities (plate_code, name, search_name) values
  (1,'Adana','adana'),(2,'Adıyaman','adiyaman'),(3,'Afyonkarahisar','afyonkarahisar'),(4,'Ağrı','agri'),
  (5,'Amasya','amasya'),(6,'Ankara','ankara'),(7,'Antalya','antalya'),(8,'Artvin','artvin'),
  (9,'Aydın','aydin'),(10,'Balıkesir','balikesir'),(11,'Bilecik','bilecik'),(12,'Bingöl','bingol'),
  (13,'Bitlis','bitlis'),(14,'Bolu','bolu'),(15,'Burdur','burdur'),(16,'Bursa','bursa'),
  (17,'Çanakkale','canakkale'),(18,'Çankırı','cankiri'),(19,'Çorum','corum'),(20,'Denizli','denizli'),
  (21,'Diyarbakır','diyarbakir'),(22,'Edirne','edirne'),(23,'Elazığ','elazig'),(24,'Erzincan','erzincan'),
  (25,'Erzurum','erzurum'),(26,'Eskişehir','eskisehir'),(27,'Gaziantep','gaziantep'),(28,'Giresun','giresun'),
  (29,'Gümüşhane','gumushane'),(30,'Hakkâri','hakkari'),(31,'Hatay','hatay'),(32,'Isparta','isparta'),
  (33,'Mersin','mersin'),(34,'İstanbul','istanbul'),(35,'İzmir','izmir'),(36,'Kars','kars'),
  (37,'Kastamonu','kastamonu'),(38,'Kayseri','kayseri'),(39,'Kırklareli','kirklareli'),(40,'Kırşehir','kirsehir'),
  (41,'Kocaeli','kocaeli'),(42,'Konya','konya'),(43,'Kütahya','kutahya'),(44,'Malatya','malatya'),
  (45,'Manisa','manisa'),(46,'Kahramanmaraş','kahramanmaras'),(47,'Mardin','mardin'),(48,'Muğla','mugla'),
  (49,'Muş','mus'),(50,'Nevşehir','nevsehir'),(51,'Niğde','nigde'),(52,'Ordu','ordu'),
  (53,'Rize','rize'),(54,'Sakarya','sakarya'),(55,'Samsun','samsun'),(56,'Siirt','siirt'),
  (57,'Sinop','sinop'),(58,'Sivas','sivas'),(59,'Tekirdağ','tekirdag'),(60,'Tokat','tokat'),
  (61,'Trabzon','trabzon'),(62,'Tunceli','tunceli'),(63,'Şanlıurfa','sanliurfa'),(64,'Uşak','usak'),
  (65,'Van','van'),(66,'Yozgat','yozgat'),(67,'Zonguldak','zonguldak'),(68,'Aksaray','aksaray'),
  (69,'Bayburt','bayburt'),(70,'Karaman','karaman'),(71,'Kırıkkale','kirikkale'),(72,'Batman','batman'),
  (73,'Şırnak','sirnak'),(74,'Bartın','bartin'),(75,'Ardahan','ardahan'),(76,'Iğdır','igdir'),
  (77,'Yalova','yalova'),(78,'Karabük','karabuk'),(79,'Kilis','kilis'),(80,'Osmaniye','osmaniye'),
  (81,'Düzce','duzce')
on conflict (plate_code) do update set name = excluded.name, search_name = excluded.search_name;

insert into public.interests (slug, label, sort_order) values
  ('canli-muzik','Canlı müzik',1),('festival','Festival',2),('tiyatro','Tiyatro',3),('sinema','Sinema',4),
  ('sergi','Sergi',5),('muze','Müze',6),('fotograf','Fotoğraf',7),('tasarim','Tasarım',8),
  ('edebiyat','Edebiyat',9),('kitap','Kitap',10),('dans','Dans',11),('stand-up','Stand-up',12),
  ('kahve','Kahve',13),('gastronomi','Gastronomi',14),('seyahat','Seyahat',15),('sehir-kesfi','Şehir keşfi',16),
  ('dogada-yasam','Doğada yaşam',17),('kamp','Kamp',18),('yuruyus','Yürüyüş',19),('kosu','Koşu',20),
  ('bisiklet','Bisiklet',21),('fitness','Fitness',22),('yoga','Yoga',23),('futbol','Futbol',24),
  ('basketbol','Basketbol',25),('teknoloji','Teknoloji',26),('yazilim','Yazılım',27),('girisimcilik','Girişimcilik',28),
  ('bilim','Bilim',29),('egitim','Eğitim',30),('atolye','Atölye',31),('networking','Networking',32),
  ('gonulluluk','Gönüllülük',33),('hayvanlar','Hayvanlar',34),('oyun','Oyun',35),('e-spor','E-spor',36),
  ('moda','Moda',37),('mimari','Mimari',38),('tarih','Tarih',39),('psikoloji','Psikoloji',40)
on conflict (slug) do update set label = excluded.label, sort_order = excluded.sort_order, is_active = true;
