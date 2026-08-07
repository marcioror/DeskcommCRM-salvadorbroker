-- 0099: eleva o limite do bucket property-media de 10MB pra 50MB.
--
-- Achado da revisão final do módulo de Imóveis: a validação de app
-- (MAX_MEDIA_BYTES/validateOutboundMedia, lib/messaging/media/, dimensionado
-- pro WhatsApp) já aceitava até 50MB, mas o bucket criado na migration 0098
-- tinha file_size_limit=10485760 (10MB) — uma foto entre 10 e 50MB passava
-- na validação de app e só falhava dentro do Supabase Storage, virando um
-- 500 cru em vez de um 4xx limpo. Alinha com o precedente de whatsapp-media
-- (migration 0055): 52428800 = 50MB.
insert into storage.buckets (id, name, public, file_size_limit)
values ('property-media', 'property-media', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
