-- 이모티콘 추천 말 — 새로 그린 `😎 골프공 반응` 열넷에 말을 단다.
-- 한 번만 돌린다(.github/workflows/sticker-words.yml · apply). 이미 있는 줄은 건너뛴다.
-- 한 글자 말(헐·헉·힝)은 그 한 글자만 쳤을 때만 뜬다. 두 글자부터는 들어 있으면 뜬다.
insert into sticker_words (sticker_id, word)
select s, w from (values
  ('rxkkk', 'ㅋㅋ,웃겨'),
  ('rxhehe', 'ㅎㅎ,히히,헤헤'),
  ('rxoh', '오~,오오,우와,오호'),
  ('rxhul', '헐,헐..,헐~'),
  ('rxheok', '헉,헉!,깜놀'),
  ('rxhdd', 'ㅎㄷㄷ,ㄷㄷ,후덜덜,무서'),
  ('rxdd', '덜덜,추워,춥다'),
  ('rxhing', '힝,힝..,히잉'),
  ('rxehyu', '에휴,휴~,한숨'),
  ('rxanwa', '아놔,아오,망했'),
  ('rxburuk', '버럭,빡쳐,열받'),
  ('rxjjj', '짜증'),
  ('rxking', '킹받'),
  ('rxdaebak', '대박,쩐다,오지네')
) as t(s, list),
lateral unnest(string_to_array(list, ',')) as w
on conflict do nothing;
