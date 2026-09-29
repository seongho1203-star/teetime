// `😎 골프공 반응` 이모티콘을 그린다 — 선글라스 낀 골프공(앱 아이콘 캐릭터).
//
// 사진·영상에서 오려 낸 다른 묶음과 달리 **이 묶음은 코드로 그린 것이다**
// (사용자 요청 — `ㅋㅋ,헐,힝,버럭 이런것들 종류가 많이 부족한거같아`).
// SVG로 그려 크로미움으로 256px 투명 PNG를 찍고, 64색 팔레트로 줄인다.
//
// 글꼴은 Jua(둥근 손글씨)다. 저장소 밖에서 받아 쓴다:
//   cd <스크래치> && npm i @fontsource/jua
//   JUA=<스크래치>/node_modules/@fontsource/jua node .dev/sticker-draw.mjs public/stickers
// 한 장만 다시 그리려면 셋째 인자로 id를 준다(`rxkkk`).
//
// **id는 `rx`로 시작한다** — `mv`로 시작하면 움직이는 것으로 읽혀 `.webp`를 찾는다.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright-core');

const INK = '#23232a';

/* ── 조각 ─────────────────────────────────────────── */

// 글자 — 그림자 · 진한 테두리 · 흰 테두리 · 위가 밝은 채움
function title(text, fill, dark, { y = 64, size = 66, x = 128, rot = 0, ghost = false } = {}) {
  const t = (extra, dx = 0, dy = 0) =>
    `<text x="${x + dx}" y="${y + dy}" text-anchor="middle" font-family="Jua" font-size="${size}" ${extra}>${text}</text>`;
  return `<defs><linearGradient id="tf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mix(fill, '#ffffff', 0.45)}"/><stop offset=".55" stop-color="${fill}"/>
      <stop offset="1" stop-color="${mix(fill, dark, 0.25)}"/></linearGradient></defs>
    <g transform="rotate(${rot} ${x} ${y})">
    ${ghost ? `<g opacity=".28">${t(`fill="${fill}" stroke="${dark}" stroke-width="10" stroke-linejoin="round"`, -7, 2)}</g>` : ''}
    ${t(`fill="${dark}" stroke="${dark}" stroke-width="15" stroke-linejoin="round" opacity=".35"`, 0, 4)}
    ${t(`fill="${dark}" stroke="${dark}" stroke-width="15" stroke-linejoin="round"`)}
    ${t(`fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"`)}
    ${t(`fill="url(#tf)"`)}
  </g>`;
}

function mix(a, b, k) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

const sparkle = (x, y, k = 1) =>
  `<path transform="translate(${x} ${y}) scale(${k})" d="M0 -15 Q2.5 -2.5 15 0 Q2.5 2.5 0 15 Q-2.5 2.5 -15 0 Q-2.5 -2.5 0 -15 Z" fill="url(#gold)" stroke="#c98a00" stroke-width="2"/>`;
const drop = (x, y, k = 1, rot = 0) =>
  `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${k})" d="M0 -13 Q9 -1 7 4 Q4 10 0 10 Q-4 10 -7 4 Q-9 -1 0 -13 Z" fill="url(#water)" stroke="#2f86dd" stroke-width="2.4"/>
   <ellipse transform="translate(${x} ${y}) rotate(${rot}) scale(${k})" cx="-2.5" cy="1" rx="2" ry="3" fill="#fff" opacity=".85"/>`;
const tear = (x, y, k = 1) =>
  `<path transform="translate(${x} ${y}) scale(${k})" d="M-6 -4 Q-9 10 -3 16 Q0 19 3 16 Q9 10 6 -4 Z" fill="url(#water)" stroke="#2f86dd" stroke-width="2.4"/>`;
const anger = (x, y, k = 1) =>
  `<g transform="translate(${x} ${y}) scale(${k})" stroke="#ec2d3a" stroke-width="6" fill="none" stroke-linecap="round">
    <path d="M-16 -4 Q-6 -6 -4 -16"/><path d="M4 -16 Q6 -6 16 -4"/><path d="M16 4 Q6 6 4 16"/><path d="M-4 16 Q-6 6 -16 4"/></g>`;
const puff = (x, y, k = 1) =>
  `<path transform="translate(${x} ${y}) scale(${k})" d="M-14 6 Q-21 -6 -8 -10 Q-4 -22 8 -16 Q21 -18 18 -4 Q27 6 12 10 Q0 16 -14 6 Z" fill="#fbfbfd" stroke="${INK}" stroke-width="3.5"/>`;
const heart = (x, y, k = 1) =>
  `<path transform="translate(${x} ${y}) scale(${k})" d="M0 6 C-12 -2 -12 -12 -5 -12 C-2 -12 0 -9 0 -7 C0 -9 2 -12 5 -12 C12 -12 12 -2 0 6 Z" fill="#ff6b8e" stroke="#c52a57" stroke-width="2"/>`;
const snow = (x, y, k = 1) =>
  `<g transform="translate(${x} ${y}) scale(${k})" stroke="#8ccfff" stroke-width="3.5" stroke-linecap="round">
    <path d="M0 -12 L0 12 M-10 -6 L10 6 M-10 6 L10 -6"/></g>`;
const shake = (x, y, flip = 1) =>
  `<g transform="translate(${x} ${y}) scale(${flip} 1)" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round">
    <path d="M0 -22 Q-7 -11 0 0 Q7 11 0 22"/><path d="M12 -14 Q7 -7 12 0 Q17 7 12 14"/></g>`;
const burst = (x, y, rot) =>
  `<g transform="translate(${x} ${y}) rotate(${rot})" stroke="${INK}" stroke-width="5" stroke-linecap="round">
    <path d="M0 0 L0 -17"/><path d="M14 3 L22 -10"/><path d="M-14 3 L-22 -10"/></g>`;

const DEFS = `<defs>
  <radialGradient id="body" cx=".36" cy=".4" r=".75">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".62" stop-color="#f3f5f9"/><stop offset="1" stop-color="#d3dae5"/></radialGradient>
  <linearGradient id="cap" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#454a5a"/><stop offset="1" stop-color="#15161b"/></linearGradient>
  <linearGradient id="lens" x1="0" y1="0" x2=".4" y2="1">
    <stop offset="0" stop-color="#3a4166"/><stop offset=".55" stop-color="#14151f"/><stop offset="1" stop-color="#050508"/></linearGradient>
  <linearGradient id="paw" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2e6ee"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff3a6"/><stop offset="1" stop-color="#ffc21a"/></linearGradient>
  <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#d4efff"/><stop offset="1" stop-color="#5cb6ff"/></linearGradient>
  <radialGradient id="blush"><stop offset="0" stop-color="#ff8fa3" stop-opacity=".85"/><stop offset="1" stop-color="#ff8fa3" stop-opacity="0"/></radialGradient>
</defs>`;

/* ── 캐릭터 ──────────────────────────────────────── */

const CX = 128, R = 72;

function paw(x, y, rot = 0, k = 1) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${k})">
    <ellipse cx="0" cy="0" rx="17" ry="14" fill="url(#paw)" stroke="${INK}" stroke-width="4.5"/>
    <path d="M-5 -9 L-5 -3 M5 -9 L5 -3" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/></g>`;
}

const PAWS = {
  down: (cy) => paw(97, cy + 71) + paw(159, cy + 71),
  up: (cy) => paw(58, cy + 8, -30) + paw(198, cy + 8, 30),
  cheek: (cy) => paw(66, cy + 32, 20) + paw(190, cy + 32, -20),
  clap: (cy) => paw(112, cy + 68, -25) + paw(144, cy + 68, 25),
  hug: (cy) => paw(70, cy + 46, 55) + paw(186, cy + 46, -55),
  raise: (cy) => paw(46, cy + 16, -35) + paw(210, cy + 16, 35),
  palm: (cy) => paw(146, cy + 4, -12, 1.55) + paw(97, cy + 71),
  none: () => '',
};

function lensPath(x0, y, mood, right) {
  // 바깥 모서리 높이 — 화나면 안쪽이 내려가고, 슬프면 바깥이 내려간다
  const lift = { angry: right ? [-10, 0] : [0, -10], sad: right ? [0, -8] : [-8, 0], wow: [-2, -2] }[mood] || [-4, -4];
  const [a, b] = right ? [lift[1], lift[0]] : lift;
  return `M${x0} ${y + a} L${x0 + 44} ${y + b} L${x0 + 40} ${y + 20} Q${x0 + 22} ${y + 31} ${x0 + 4} ${y + 20} Z`;
}

function ball({ cy = 162, tilt = 0, mood = 'normal', paws = 'down', tint = '', blush = false, mouth = '', face = '', shadow = true }) {
  const dimples = [[-46, 28], [-26, 46], [0, 56], [28, 48], [50, 28], [-56, 6], [58, 4], [-38, 60], [40, 60], [-12, 36], [18, 30]]
    .map(([dx, dy]) => `<circle cx="${CX + dx}" cy="${cy + dy}" r="4.3" fill="#dbe1ea"/><circle cx="${CX + dx - 1}" cy="${cy + dy - 1.2}" r="2.2" fill="#eef1f6"/>`)
    .join('');
  const ly = cy - 6;
  const lens = (x0, right) => `
    <path d="${lensPath(x0, ly, mood, right)}" fill="url(#lens)" stroke="#07070b" stroke-width="3" stroke-linejoin="round"/>
    <path d="M${x0 + 9} ${ly + 15} L${x0 + 19} ${ly + 1}" stroke="#fff" stroke-width="4.2" stroke-linecap="round" opacity=".9"/>
    <path d="M${x0 + 18} ${ly + 17} L${x0 + 24} ${ly + 9}" stroke="#fff" stroke-width="2.8" stroke-linecap="round" opacity=".55"/>`;
  const cheeks = blush
    ? `<ellipse cx="86" cy="${cy + 30}" rx="15" ry="9" fill="url(#blush)"/><ellipse cx="170" cy="${cy + 30}" rx="15" ry="9" fill="url(#blush)"/>`
    : '';
  return `${shadow ? `<ellipse cx="128" cy="${Math.min(cy + 84, 250)}" rx="62" ry="6" fill="#000" opacity=".16"/>` : ''}
  <g transform="rotate(${tilt} ${CX} ${cy + 40})">
    <defs><clipPath id="bc"><circle cx="${CX}" cy="${cy}" r="${R}"/></clipPath>
      ${tint ? `<linearGradient id="tint" x1="0" y1="0" x2="0" y2="1"><stop offset=".25" stop-color="${tint}" stop-opacity="0"/><stop offset="1" stop-color="${tint}" stop-opacity=".55"/></linearGradient>` : ''}</defs>
    <circle cx="${CX}" cy="${cy}" r="${R}" fill="url(#body)"/>
    <g clip-path="url(#bc)">
      ${dimples}
      ${tint ? `<rect x="0" y="0" width="256" height="256" fill="url(#tint)"/>` : ''}
      <path d="M${CX - R - 4} ${cy - 22} Q${CX} ${cy - 42} ${CX + R + 4} ${cy - 22} L${CX + R + 4} ${cy - R - 4} L${CX - R - 4} ${cy - R - 4} Z" fill="url(#cap)"/>
      <path d="M${CX} ${cy - R} L${CX + 4} ${cy - 30}" stroke="#565b6c" stroke-width="2" opacity=".8"/>
      <path d="M${CX - 44} ${cy - 56} Q${CX - 14} ${cy - 71} ${CX + 18} ${cy - 64}" stroke="#7a8095" stroke-width="6" fill="none" stroke-linecap="round" opacity=".75"/>
    </g>
    <circle cx="${CX}" cy="${cy - R + 3}" r="5" fill="#2e3140" stroke="${INK}" stroke-width="3"/>
    <path d="M${CX + 18} ${cy - 34} Q${CX + 70} ${cy - 46} ${CX + 102} ${cy - 22} Q${CX + 74} ${cy - 16} ${CX + 28} ${cy - 21} Z" fill="url(#cap)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M${CX + 34} ${cy - 24} Q${CX + 70} ${cy - 26} ${CX + 94} ${cy - 22}" stroke="#565b6c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <circle cx="${CX}" cy="${cy}" r="${R}" fill="none" stroke="${INK}" stroke-width="6.5"/>
    ${cheeks}
    ${lens(80, false)}${lens(132, true)}
    <path d="M122 ${ly + 4} Q128 ${ly} 134 ${ly + 4}" stroke="#07070b" stroke-width="5" fill="none" stroke-linecap="round"/>
    ${face}
    ${mouth}
    ${PAWS[paws](cy)}
  </g>`;
}

// 입 모양 — cy 기준
const M = {
  laugh: (cy) => `<path d="M94 ${cy + 30} Q128 ${cy + 36} 162 ${cy + 30} Q156 ${cy + 74} 128 ${cy + 76} Q100 ${cy + 74} 94 ${cy + 30} Z" fill="#7a1420" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M100 ${cy + 33} L156 ${cy + 33} L154 ${cy + 41} L102 ${cy + 41} Z" fill="#fff"/>
    <path d="M110 ${cy + 64} Q128 ${cy + 52} 146 ${cy + 64} Q139 ${cy + 74} 128 ${cy + 74} Q117 ${cy + 74} 110 ${cy + 64} Z" fill="#ff7a8a"/>`,
  smile: (cy) => `<path d="M110 ${cy + 38} Q128 ${cy + 56} 146 ${cy + 38}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>`,
  o: (cy, rx = 9, ry = 11) => `<ellipse cx="128" cy="${cy + 44}" rx="${rx}" ry="${ry}" fill="#7a1420" stroke="${INK}" stroke-width="4.5"/><ellipse cx="128" cy="${cy + 44 + ry * 0.45}" rx="${rx * 0.55}" ry="${ry * 0.35}" fill="#ff7a8a"/>`,
  shout: (cy) => `<path d="M110 ${cy + 36} Q128 ${cy + 28} 146 ${cy + 36} Q148 ${cy + 62} 128 ${cy + 64} Q108 ${cy + 62} 110 ${cy + 36} Z" fill="#7a1420" stroke="${INK}" stroke-width="4.5"/>
    <path d="M116 ${cy + 56} Q128 ${cy + 50} 140 ${cy + 56} Q134 ${cy + 63} 128 ${cy + 63} Q122 ${cy + 63} 116 ${cy + 56} Z" fill="#ff7a8a"/>`,
  pout: (cy) => `<path d="M110 ${cy + 50} Q119 ${cy + 40} 128 ${cy + 48} Q137 ${cy + 40} 146 ${cy + 50}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>`,
  roar: (cy) => `<path d="M98 ${cy + 36} Q128 ${cy + 24} 158 ${cy + 36} L152 ${cy + 60} Q128 ${cy + 68} 104 ${cy + 60} Z" fill="#7a1420" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M102 ${cy + 37} Q128 ${cy + 27} 154 ${cy + 37} L153 ${cy + 44} Q128 ${cy + 35} 103 ${cy + 44} Z" fill="#fff"/>
    <path d="M114 ${cy + 60} Q128 ${cy + 52} 142 ${cy + 60} Q128 ${cy + 66} 114 ${cy + 60} Z" fill="#ff7a8a"/>`,
  grit: (cy) => `<rect x="100" y="${cy + 34}" width="56" height="20" rx="8" fill="#fff" stroke="${INK}" stroke-width="4.5"/>
    <path d="M100 ${cy + 44} L156 ${cy + 44} M114 ${cy + 34} L114 ${cy + 54} M128 ${cy + 34} L128 ${cy + 54} M142 ${cy + 34} L142 ${cy + 54}" stroke="${INK}" stroke-width="2.6"/>`,
  chatter: (cy) => `<rect x="102" y="${cy + 34}" width="52" height="20" rx="8" fill="#fff" stroke="${INK}" stroke-width="4.5"/>
    <path d="M102 ${cy + 44} L108 ${cy + 38} L115 ${cy + 50} L122 ${cy + 38} L128 ${cy + 50} L135 ${cy + 38} L142 ${cy + 50} L148 ${cy + 38} L154 ${cy + 44}" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linejoin="round"/>`,
  wave: (cy) => `<path d="M106 ${cy + 46} Q112 ${cy + 38} 118 ${cy + 46} Q124 ${cy + 54} 130 ${cy + 46} Q136 ${cy + 38} 142 ${cy + 46} Q148 ${cy + 54} 152 ${cy + 46}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  sigh: (cy) => `<ellipse cx="122" cy="${cy + 44}" rx="9" ry="6" fill="#7a1420" stroke="${INK}" stroke-width="4.5"/>`,
  flat: (cy) => `<path d="M110 ${cy + 46} Q120 ${cy + 42} 128 ${cy + 46} Q136 ${cy + 50} 146 ${cy + 44}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>`,
  squiggle: (cy) => `<path d="M104 ${cy + 46} Q116 ${cy + 34} 128 ${cy + 46} Q140 ${cy + 34} 152 ${cy + 46}" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`,
};

/* ── 한 장씩 ─────────────────────────────────────── */

const C = 162;
export const STICKERS = {
  rxkkk: ['ㅋㅋㅋ', () => title('ㅋㅋㅋ', '#ffc21a', '#c9540a', { rot: -6, size: 72 }) +
    ball({ cy: C + 2, tilt: -12, blush: true, mouth: M.laugh(C + 2) }) +
    drop(40, 150, 1.2, -20) + drop(220, 140, 1.1, 20) + drop(28, 190, 0.8, -30)],
  rxhehe: ['ㅎㅎ', () => title('ㅎㅎ', '#ff7eb3', '#b8246a', { size: 74 }) +
    ball({ cy: C, tilt: 6, paws: 'cheek', blush: true, mouth: M.smile(C) }) +
    sparkle(216, 112, 1) + heart(42, 118, 1.3)],
  rxoh: ['오~', () => title('오~', '#2fcf9f', '#0f7a5c', { size: 76 }) +
    ball({ cy: C, mood: 'wow', paws: 'clap', blush: true, mouth: M.o(C, 8, 10) }) +
    sparkle(36, 118, 1.1) + sparkle(222, 110, 1.2) + sparkle(222, 176, 0.7) + sparkle(34, 186, 0.7)],
  rxhul: ['헐...', () => title('헐...', '#9068ff', '#4020a8', { size: 68 }) +
    ball({ cy: C, mouth: M.o(C, 12, 17) }) +
    drop(206, 116, 1.3, 15) +
    `<path d="M40 108 L40 128" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><circle cx="40" cy="140" r="4" fill="${INK}"/>`],
  rxheok: ['헉!!', () => title('헉!!', '#ff7a1a', '#b83a00', { rot: 4, size: 68 }) +
    ball({ cy: C + 4, tilt: 14, paws: 'up', mouth: M.shout(C + 4) }) +
    burst(58, 104, -30) + burst(198, 100, 30) + drop(216, 150, 1, 20)],
  rxhdd: ['ㅎㄷㄷ', () => title('ㅎㄷㄷ', '#4f9dff', '#1846a8', { size: 70, ghost: true }) +
    ball({ cy: C, tint: '#6fb5ff', mouth: M.wave(C) }) +
    shake(34, 170, 1) + shake(222, 170, -1) + drop(206, 116, 1.1, 15) + drop(52, 124, 0.9, -15)],
  rxdd: ['덜덜', () => title('덜덜', '#6cc7ff', '#1767b0', { size: 72, ghost: true }) +
    ball({ cy: C, tint: '#8fd0ff', paws: 'hug', mouth: M.chatter(C) }) +
    snow(34, 118, 1) + snow(224, 122, 0.8) + snow(222, 196, 0.6) +
    `<g opacity=".5">${shake(32, 188, 1)}${shake(226, 188, -1)}</g>`],
  rxhing: ['힝...', () => title('힝...', '#56b8ff', '#135fb0', { size: 70 }) +
    ball({ cy: C, mood: 'sad', paws: 'cheek', blush: true, mouth: M.pout(C),
      face: tear(92, C + 34, 1.1) + tear(164, C + 34, 1.1) })],
  rxehyu: ['에휴~', () => title('에휴~', '#95a5b8', '#3d4a5c', { size: 66 }) +
    ball({ cy: C + 4, tilt: -5, mood: 'sad', mouth: M.sigh(C + 4) }) +
    `<path transform="translate(70 ${C + 52})" d="M0 0 Q-14 -4 -22 4 Q-34 2 -38 12 Q-30 22 -18 18 Q-8 24 0 14 Z" fill="#f1f5f9" stroke="${INK}" stroke-width="3.5"/>` +
    `<path d="M200 106 q9 10 0 20 q-9 10 0 20" stroke="#95a5b8" stroke-width="5" fill="none" stroke-linecap="round"/>`],
  rxanwa: ['아놔', () => title('아놔~', '#ff9a3c', '#a4480a', { rot: -3, size: 68 }) +
    ball({ cy: C + 2, tilt: 6, paws: 'palm', mouth: M.flat(C + 2) }) +
    drop(58, 118, 1.4, -15) + drop(40, 150, 0.8, -20) +
    `<g stroke="#6b7a90" stroke-width="3.5" stroke-linecap="round" opacity=".8"><path d="M206 206 l0 12"/><path d="M216 202 l0 14"/><path d="M196 210 l0 10"/></g>`],
  rxburuk: ['버럭!', () => title('버럭!', '#ff3b30', '#8f0e0a', { rot: -4, size: 72 }) +
    ball({ cy: C + 2, mood: 'angry', paws: 'raise', tint: '#ff6a5a', mouth: M.roar(C + 2) }) +
    anger(200, 104, 1.1) + puff(34, 108, 1.1) + puff(226, 150, 0.8)],
  rxjjj: ['짜증나', () => title('짜증나', '#ff6a3d', '#9c2a07', { rot: 3, size: 64 }) +
    ball({ cy: C, mood: 'angry', mouth: M.grit(C) }) +
    anger(50, 116, 1) + shake(28, 176, 1) + shake(228, 176, -1)],
  rxking: ['킹받네', () => title('킹받네', '#ff3b30', '#8f0e0a', { rot: 4, size: 64 }) +
    ball({ cy: C + 2, mood: 'angry', tint: '#ff7a6a', mouth: M.squiggle(C + 2) }) +
    anger(206, 110, 1.1) + anger(48, 120, 0.8) + puff(226, 172, 0.8)],
  rxdaebak: ['대박!', () => title('대박!', '#ffc21a', '#c24d00', { rot: -4, size: 72 }) +
    ball({ cy: C + 2, mood: 'wow', paws: 'up', blush: true, mouth: M.laugh(C + 2) }) +
    sparkle(30, 124, 1.1) + sparkle(224, 116, 1) + sparkle(38, 202, 0.8) + sparkle(220, 204, 0.9)],
};

/* ── 찍기 ─────────────────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.resolve(process.argv[2] || 'out');
  const only = process.argv[3];
  const jua = process.env.JUA;
  if (!jua) throw new Error('JUA=<@fontsource/jua 자리>를 주세요');
  const css = fs.readFileSync(path.join(jua, 'index.css'), 'utf8').replaceAll('url(./files/', `url(file://${jua}/files/`);
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync('/tmp/stk-');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  for (const [id, [, draw]] of Object.entries(STICKERS)) {
    if (only && id !== only) continue;
    const html = `<html><head><style>${css} html,body{margin:0;background:transparent}</style></head><body>
      <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${DEFS}<g transform="translate(128 130) scale(.9) translate(-128 -128)">${draw()}</g></svg></body></html>`;
    fs.writeFileSync(`${tmp}/p.html`, html);
    await page.goto(`file://${tmp}/p.html`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    const raw = `${tmp}/${id}.png`;
    await page.screenshot({ path: raw, omitBackground: true });
    // 64색 팔레트로 — 알파 8 아래는 완전 투명으로 밀어야 네모 자국이 안 남는다
    execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(raw)}).convert('RGBA')
px = im.load()
for y in range(im.height):
  for x in range(im.width):
    if px[x, y][3] < 8: px[x, y] = (0, 0, 0, 0)
im.quantize(64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(${JSON.stringify(`${out}/${id}.png`)}, optimize=True)
`]);
  }
  await browser.close();
  console.log('done', out);
}
