-- Equipamentos iniciais do Estudio ASSEGO
-- Execute depois do schema.sql.

insert into public.equipment (name, category, patrimony_code, location, status, notes, image_url)
values
  ('Camera Blackmagic 01', 'Camera', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Camera Blackmagic 02', 'Camera', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Camera Blackmagic 03', 'Camera', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('ATEM Mini Pro 01', 'Video switcher', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('ATEM Mini Pro 02', 'Video switcher', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Softbox de iluminacao', 'Iluminacao', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('LED colorido 01', 'Iluminacao', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('LED colorido 02', 'Iluminacao', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Fone AKG', 'Audio', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Mesa de audio', 'Audio', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Tripe 01', 'Suporte', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Tripe 02', 'Suporte', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Tripe 03', 'Suporte', null, 'Estudio principal', 'missing', 'ALERTA: Lucas informou que este tripe esta faltando.', null),
  ('Microfone condensador podcast 01', 'Audio', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Microfone condensador podcast 02', 'Audio', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Microfone condensador podcast 03', 'Audio', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Microfone condensador podcast 04', 'Audio', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Bateria Blackmagic 01', 'Energia', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Bateria Blackmagic 02', 'Energia', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Bateria Blackmagic 03', 'Energia', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null),
  ('Filtro de linha de energia', 'Energia', null, 'Estudio principal', 'available', 'Item inicial informado por Lucas.', null);
