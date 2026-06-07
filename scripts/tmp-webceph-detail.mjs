import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import sharp from 'sharp';

const partnerApiKey = 'Schwan2WkiF7fg3uNLmUwqWznfk3oFmV8MAbdulkareem';
const userEmail = 'dentistsalam83@gmail.com';
const pass = '1983yarmok';
const k = Buffer.from(userEmail + partnerApiKey, 'utf-8');
const d = Buffer.from(pass, 'utf-8');
const o = Buffer.allocUnsafe(d.length);
for (let i = 0; i < d.length; i++) o[i] = d[i] ^ k[i % k.length];
const apipass = o.toString('base64');
const H = { 'X-Partner-ApiKey': partnerApiKey, 'X-User-ApiUsername': userEmail, 'X-User-ApiPass': apipass };

const png = fs.readFileSync('C:\\Users\\Administrator\\Desktop\\_20260606_165855.png');
const jpeg = await sharp(png).resize({ width: 700, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();

const RH = '2026-06-05'; // fresh record date

async function addRecord() {
  const res = await fetch('https://api.webceph.com/api/v1/addnewpatientrecord/', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ patientid: '007202', recorddate: RH }).toString(),
  });
  console.log('addRecord:', (await res.json()).result);
}

async function upload(cls, overwrite) {
  const fd = new FormData();
  fd.append('patientid', '007202');
  fd.append('recordhash', RH);
  fd.append('targetclass', cls);
  fd.append('overwrite', overwrite);
  fd.append('file', jpeg, { filename: 'x.jpg', contentType: 'image/jpeg' });
  const res = await fetch('https://api.webceph.com/api/v1/uploadrecordphoto/', { method: 'POST', headers: { ...H, ...fd.getHeaders() }, body: fd });
  const j = await res.json();
  console.log(`upload ${cls} (overwrite=${overwrite}):`, j.result || j.error);
}

async function detail(tag) {
  const res = await fetch('https://api.webceph.com/api/v1/getrecorddetail/?' + new URLSearchParams({ patientid: '007202', recordhash: RH }), { headers: H });
  const j = await res.json();
  const on = Object.entries(j.record).filter(([key, v]) => key.startsWith('is_') && v === true).map(([key]) => key);
  console.log(`  [${tag}] slots ON:`, on.join(', ') || '(none)');
}

await addRecord();
await upload('lateral_ceph', 'true'); await detail('after lateral_ceph');
await upload('orthopan', 'true');     await detail('after orthopan');
await upload('io_photo_frontal', 'true'); await detail('after io_frontal');
