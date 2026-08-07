-- VisuPlanner v29: tillad Speak-optagelser i det eksisterende medielager.
-- Eksisterende data, filer og sikkerhedspolitikker bevares.
begin;

update storage.buckets
set allowed_mime_types = case
  when allowed_mime_types is null then array['image/*', 'audio/*']::text[]
  when not ('audio/*' = any(allowed_mime_types)) then array_append(allowed_mime_types, 'audio/*')
  else allowed_mime_types
end
where id = 'visuplan-images';

commit;
