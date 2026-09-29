-- 이모티콘 추천 말 — 자주 쓰는 반응(ㅋㅋ·헐·헉·힝·버럭·짜증)에 걸리는
-- 이모티콘이 서너 장뿐이라, 그림이 맞는 것에 말을 더 얹었다.
-- 한 번만 돌린다(.github/workflows/sticker-words.yml · apply). 이미 있는 줄은 건너뛴다.
-- 한 글자 말(헐·헉·힝)은 그 한 글자만 쳤을 때만 뜬다.
insert into sticker_words (sticker_id, word)
select s, w from (values
  -- ㅋㅋ · ㅎㅎ (지금 4장)
  ('pnyay', 'ㅋㅋ,ㅎㅎ'),
  ('mvp44', 'ㅋㅋ,ㅎㅎ'),
  ('gmyay', 'ㅋㅋ,ㅎㅎ'),
  ('ctlove', 'ㅋㅋ,ㅎㅎ'),
  ('emwink', 'ㅋㅋ,메롱'),
  -- 헐 · 헉 (한 글자만 칠 때 — 지금 1장)
  ('mvp26', '헐,헉'),
  ('pnhuh', '헐,헉'),
  ('gfhuh', '헐,헉'),
  ('emshock', '헐,헉'),
  -- 힝 (지금 1장)
  ('gsad', '힝'),
  ('mvp25', '힝'),
  ('pncry', '힝'),
  ('ctcry', '힝'),
  ('emsob', '힝'),
  ('emcry', '힝'),
  -- 버럭 · 짜증 (지금 3장)
  ('emangry', '버럭,짜증'),
  ('pangry', '버럭'),
  ('wbhmph', '버럭,짜증'),
  ('mvp45', '짜증'),
  ('pnangry', '짜증'),
  ('gmaja', '짜증')
) as t(s, list),
lateral unnest(string_to_array(list, ',')) as w
on conflict do nothing;
