#!/usr/bin/env node
/* BookIt v63 — asset builder (fallback route).
   Usage: node get-assets.mjs   (run from the repo root; needs ffmpeg on PATH)
   Downloads the generated sources from their public CDN URLs and produces
   every derived file into public/assets/world/. Idempotent. */
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { get } from 'node:https';
import { createWriteStream } from 'node:fs';
import { spawnSync } from 'node:child_process';

const BASE = 'https://d8j0ntlcm91z4.cloudfront.net/user_3HOYboDggMh2zJCtNQ6rs6E2iqP';
const W = 'public/assets/world';
const SRC = {
  'src-film.mp4':            `${BASE}/hf_20260803_110047_f1b33bca-81bd-4af9-81c7-c721002eb05b.mp4`,
  'src-employment.png':      `${BASE}/hf_20260803_094142_6c7b73a4-f984-4e05-af24-70b62b0421f3.png`,
  'src-personal-care.png':   `${BASE}/hf_20260803_094146_a32faaf9-700a-4821-9a1f-98a665bf1188.png`,
  'src-transport.png':       `${BASE}/hf_20260803_094152_519bf148-de58-4c33-8d44-692e7a6ce9a9.png`,
  'src-daily-tasks.png':     `${BASE}/hf_20260803_094156_3a55b0a4-0993-401b-9e37-1f1b64694800.png`,
  'src-household.png':       `${BASE}/hf_20260803_094200_eb3dd0e5-76ca-4a9d-aceb-3d6d5cd1981f.png`,
  'src-community.png':       `${BASE}/hf_20260803_094205_e96d6d5a-df80-4600-bbec-b7d81f49deab.png`,
};

const dl = (url, dest) => new Promise((res, rej) => {
  const go = (u, n) => get(u, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 4) return go(r.headers.location, n + 1);
    if (r.statusCode !== 200) return rej(new Error(`${r.statusCode} ${u}`));
    const f = createWriteStream(dest); r.pipe(f); f.on('finish', () => f.close(res));
  }).on('error', rej);
  go(url, 0);
});

const ff = (...args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
};

mkdirSync(W, { recursive: true });
const need = f => !existsSync(`${W}/${f}`) || statSync(`${W}/${f}`).size === 0;

for (const [name, url] of Object.entries(SRC)) {
  if (need(name)) { console.log('fetch', name); await dl(url, `${W}/${name}`); }
}

console.log('encode: desktop scrub clip (CRF 20, GOP 8)');
ff('-i', `${W}/src-film.mp4`, '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
   '-pix_fmt', 'yuv420p', '-g', '8', '-keyint_min', '8', '-sc_threshold', '0',
   '-movflags', '+faststart', `${W}/fit.mp4`);
console.log('encode: mobile scrub clip (720p, CRF 23, GOP 4)');
ff('-i', `${W}/src-film.mp4`, '-an', '-vf', 'scale=-2:720', '-c:v', 'libx264', '-preset', 'fast',
   '-crf', '23', '-pix_fmt', 'yuv420p', '-g', '4', '-keyint_min', '4', '-sc_threshold', '0',
   '-movflags', '+faststart', `${W}/fit-mobile.mp4`);
console.log('posters from the encoded clips');
ff('-i', `${W}/fit.mp4`, '-frames:v', '1', '-q:v', '2', `${W}/fit-poster.jpg`);
ff('-i', `${W}/fit-mobile.mp4`, '-frames:v', '1', '-q:v', '3', `${W}/fit-mobile-poster.jpg`);
console.log('plates -> 2048w JPG');
for (const s of ['employment', 'personal-care', 'transport', 'daily-tasks', 'household', 'community'])
  ff('-i', `${W}/src-${s}.png`, '-vf', 'scale=2048:-2', '-q:v', '4', `${W}/plate-${s}.jpg`);
console.log('og card (1200x630 crop of the film poster)');
ff('-i', `${W}/fit-poster.jpg`, '-vf', 'scale=1200:-2,crop=1200:630', '-q:v', '3', `${W}/og.jpg`);

for (const f of ['fit.mp4','fit-mobile.mp4','fit-poster.jpg','fit-mobile-poster.jpg','og.jpg',
                 'plate-employment.jpg','plate-personal-care.jpg','plate-transport.jpg',
                 'plate-daily-tasks.jpg','plate-household.jpg','plate-community.jpg'])
  console.log(f.padEnd(24), (statSync(`${W}/${f}`).size / 1024).toFixed(0) + ' KB');
console.log('\nDone. Sources (src-*) can be deleted or kept as originals.');
