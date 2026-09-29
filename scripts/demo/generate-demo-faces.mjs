// Draws the demo patient's three FACIAL views (i10 Profile, i12 Rest, i13 Smile) for each demo
// timepoint into data/demo/photos/<timepoint>/. They are computer-drawn illustrations, not photos of
// anyone: the demo pack's intraoral views are real (de-identified) photos, but a face is a person,
// so the faces are drawn. Re-run after editing: `node scripts/demo/generate-demo-faces.mjs`.
//
// Output aspect matches the photo editor's facial slots (VIEW_OUTPUT 3467×4000), and the smile
// follows the intraoral story: crowded at the start, brackets mid-treatment, aligned at the end.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../data/demo/photos/', import.meta.url));
const W = 780;
const H = 900;

const P = {
  skin: '#e2b08f',
  skinShade: '#c98f6d',
  skinDeep: '#b27658',
  hair: '#2b1f19',
  hairHi: '#4a372c',
  iris: '#5b3a22',
  lip: '#c4776d',
  lipDark: '#a55d56',
  shirt: '#2f4a78',
  shirtShade: '#243a60',
  mouth: '#5a1d22',
  tooth: '#f6f1e6',
  metal: '#9aa4ad',
};

const TIMEPOINTS = [
  { dir: '01-initial', stage: 'crowded' },
  { dir: '02-progress', stage: 'braces' },
  { dir: '03-progress', stage: 'braces' },
  { dir: '04-final', stage: 'aligned' },
];

const background = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dfe7ef"/><stop offset="1" stop-color="#c3cfdb"/>
    </linearGradient>
    <radialGradient id="face" cx="0.45" cy="0.4" r="0.7">
      <stop offset="0" stop-color="${P.skin}"/><stop offset="0.75" stop-color="${P.skin}"/>
      <stop offset="1" stop-color="${P.skinShade}"/>
    </radialGradient>
    <linearGradient id="neck" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.skinDeep}"/><stop offset="0.35" stop-color="${P.skinShade}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>`;

const shoulders = `
  <path d="M40 900 C60 790 220 735 330 718 L450 718 C560 735 720 790 740 900 Z" fill="${P.shirt}"/>
  <path d="M330 718 L390 790 L450 718 Z" fill="${P.skinShade}"/>
  <path d="M322 716 L390 800 L458 716" fill="none" stroke="${P.shirtShade}" stroke-width="10" stroke-linejoin="round"/>`;

/** One row of upper teeth across the smile, per treatment stage. */
function upperTeeth(stage) {
  // x centre, width — canine to canine (+ first premolars), symmetric about 390.
  const teeth = [
    [328, 11], [342, 12], [356, 13], [372, 15], [390, 17], [408, 15], [424, 13], [438, 12], [452, 11],
  ].map(([x, w]) => ({ x, w }));
  // Crowded: laterals tucked + rotated, one canine blocked out high — the look of the initial photos.
  const crowd = { 2: { dy: 4, rot: -12 }, 6: { dy: 5, rot: 10 }, 1: { dy: -6, rot: 6 }, 3: { dy: 1, rot: -5 }, 5: { dy: 2, rot: 6 } };
  const parts = [];
  teeth.forEach((t, i) => {
    const c = stage === 'crowded' ? crowd[i] ?? { dy: 0, rot: 0 } : { dy: 0, rot: 0 };
    const h = 22 - Math.abs(i - 4) * 1.4;
    parts.push(
      `<rect x="${t.x - t.w / 2}" y="${521 + c.dy}" width="${t.w}" height="${h}" rx="3.5" fill="${P.tooth}" stroke="#d9d0bf" stroke-width="1"
        transform="rotate(${c.rot} ${t.x} ${530 + c.dy})"/>`
    );
    if (stage === 'braces') {
      parts.push(`<rect x="${t.x - 3.5}" y="${528}" width="7" height="6" rx="1" fill="${P.metal}" stroke="#6f7881" stroke-width="0.8"/>`);
    }
  });
  if (stage === 'braces') parts.push(`<path d="M322 531 Q390 527 458 531" fill="none" stroke="#7c858d" stroke-width="1.6"/>`);
  return parts.join('');
}

function frontal({ smile, stage }) {
  const mouth = smile
    ? `
    <clipPath id="m"><path d="M322 520 Q390 504 458 520 Q448 574 390 580 Q332 574 322 520 Z"/></clipPath>
    <path d="M322 520 Q390 504 458 520 Q448 574 390 580 Q332 574 322 520 Z" fill="${P.mouth}"/>
    <g clip-path="url(#m)">${upperTeeth(stage)}
      <path d="M340 566 Q390 552 440 566 L440 590 L340 590 Z" fill="#e9e2d4" opacity="0.8"/></g>
    <path d="M318 519 Q354 506 390 512 Q426 506 462 519 Q426 514 390 518 Q354 514 318 519 Z" fill="${P.lip}"/>
    <path d="M330 552 Q390 598 450 552 Q444 586 390 592 Q336 586 330 552 Z" fill="${P.lip}"/>
    <path d="M314 516 Q306 522 312 530 M466 516 Q474 522 468 530" stroke="${P.skinShade}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `
    <path d="M343 530 Q366 519 390 525 Q414 519 437 530 Q390 537 343 530 Z" fill="${P.lip}"/>
    <path d="M346 531 Q390 566 434 531 Q390 545 346 531 Z" fill="${P.lip}"/>
    <path d="M343 530 Q390 538 437 530" stroke="${P.lipDark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  const cheeks = smile
    ? `<ellipse cx="300" cy="470" rx="42" ry="24" fill="#d88f7c" opacity="0.28"/><ellipse cx="480" cy="470" rx="42" ry="24" fill="#d88f7c" opacity="0.28"/>`
    : `<ellipse cx="298" cy="470" rx="40" ry="22" fill="#d88f7c" opacity="0.18"/><ellipse cx="482" cy="470" rx="40" ry="22" fill="#d88f7c" opacity="0.18"/>`;
  const eyes = [330, 450]
    .map((cx) => {
      const squint = smile ? 3 : 0;
      return `
      <path d="M${cx - 31} 356 Q${cx} ${334 + squint} ${cx + 31} 356 Q${cx} ${373 - squint} ${cx - 31} 356 Z" fill="#fbfaf7"/>
      <circle cx="${cx}" cy="356" r="12.5" fill="${P.iris}"/><circle cx="${cx}" cy="356" r="6" fill="#1b1411"/>
      <circle cx="${cx + 4}" cy="351.5" r="3" fill="#ffffff"/>
      <path d="M${cx - 33} 356 Q${cx} ${331 + squint} ${cx + 33} 356" stroke="#2a1c16" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${background}
  <g transform="translate(390 470) scale(1.14) translate(-390 -470)">
  <path d="M322 560 L322 735 Q390 770 458 735 L458 560 Z" fill="url(#neck)"/>
  ${shoulders}
  <ellipse cx="206" cy="405" rx="23" ry="46" fill="${P.skinShade}"/><ellipse cx="574" cy="405" rx="23" ry="46" fill="${P.skinShade}"/>
  <path d="M390 150 C520 150 572 262 572 382 C572 482 532 562 472 612 C442 637 416 648 390 648 C364 648 338 637 308 612 C248 562 208 482 208 382 C208 262 260 150 390 150 Z" fill="url(#face)"/>
  <path d="M204 372 C186 222 268 116 392 114 C522 112 602 214 580 372 C566 306 552 258 506 228 C446 252 336 248 280 226 C238 254 220 306 204 372 Z" fill="${P.hair}"/>
  <path d="M280 226 C336 248 446 252 506 228 C470 214 420 206 392 206 C352 206 312 212 280 226 Z" fill="${P.hairHi}" opacity="0.55"/>
  <path d="M288 318 Q328 300 366 314" stroke="#2a1c16" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M414 314 Q452 300 492 318" stroke="#2a1c16" stroke-width="9" fill="none" stroke-linecap="round"/>
  ${eyes}
  <path d="M386 372 C382 420 372 448 370 460" stroke="${P.skinShade}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M366 462 Q390 480 414 462" stroke="${P.skinDeep}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="376" cy="464" rx="6" ry="3.5" fill="${P.skinDeep}" opacity="0.7"/><ellipse cx="404" cy="464" rx="6" ry="3.5" fill="${P.skinDeep}" opacity="0.7"/>
  ${cheeks}
  <g transform="translate(390 540) scale(1.32) translate(-390 -540)">${mouth}</g>
  </g>
</svg>`;
}

function profile() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${background}
  <g transform="translate(390 470) scale(1.14) translate(-390 -470)">
  <path d="M330 590 L330 740 L480 740 L472 600 Z" fill="url(#neck)"/>
  <path d="M60 900 C90 790 250 736 340 724 L470 724 C560 736 700 800 720 900 Z" fill="${P.shirt}"/>
  <path d="M398 150 C478 146 540 190 552 262 C556 290 552 312 550 330 C552 346 560 360 572 380
           C586 402 602 422 604 434 C606 446 594 452 576 456 C566 458 562 466 566 478
           C570 490 566 498 556 504 C562 512 566 520 560 530 C556 542 548 552 546 566
           C544 590 528 612 500 622 C484 628 474 640 472 660 L330 660 C318 600 280 568 256 520
           C228 462 226 380 244 312 C266 222 318 154 398 150 Z" fill="url(#face)"/>
  <path d="M550 252 C542 190 482 146 398 146 C318 150 262 222 242 312 C230 380 236 450 262 505
           C290 520 330 470 352 440 C370 402 386 380 394 368 C398 330 406 282 432 242
           C470 222 520 228 550 252 Z" fill="${P.hair}"/>
  <path d="M430 214 C470 206 520 214 552 236 C530 204 494 188 452 190 Z" fill="${P.hairHi}" opacity="0.55"/>
  <ellipse cx="352" cy="402" rx="30" ry="44" fill="${P.skinShade}"/>
  <path d="M344 380 Q356 400 346 424" stroke="${P.skinDeep}" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M488 318 Q516 306 546 316" stroke="#2a1c16" stroke-width="8" fill="none" stroke-linecap="round"/>
  <path d="M508 352 Q528 340 546 352 Q528 362 508 352 Z" fill="#fbfaf7"/>
  <circle cx="536" cy="352" r="6" fill="${P.iris}"/><circle cx="538" cy="352" r="3" fill="#1b1411"/>
  <path d="M504 350 Q526 336 548 350" stroke="#2a1c16" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <path d="M572 452 Q560 452 552 446" stroke="${P.skinDeep}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M566 478 C572 488 566 498 556 504 C560 500 562 494 556 490 Z" fill="${P.lip}"/>
  <path d="M556 504 C562 512 566 520 560 530 C552 526 548 516 550 506 Z" fill="${P.lip}"/>
  <ellipse cx="470" cy="470" rx="36" ry="22" fill="#d88f7c" opacity="0.18"/>
  </g>
</svg>`;
}

for (const { dir, stage } of TIMEPOINTS) {
  mkdirSync(`${OUT}${dir}`, { recursive: true });
  const views = { i10: profile(), i12: frontal({ smile: false, stage }), i13: frontal({ smile: true, stage }) };
  for (const [view, svg] of Object.entries(views)) {
    await sharp(Buffer.from(svg)).jpeg({ quality: 80, mozjpeg: true }).toFile(`${OUT}${dir}/${view}.jpg`);
  }
}
console.log(`faces written to ${OUT}`);
