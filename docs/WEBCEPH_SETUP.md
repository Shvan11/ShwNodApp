# WebCeph Integration

WebCeph is an AI-powered cephalometric-analysis platform. The app pushes a patient
(and their X-ray images) to WebCeph via the **Partner API**, stores the returned
record link, and surfaces it from the Edit Patient page ("WebCeph AI X-Ray Analysis").

**Status: implemented and working.** The integration is optional — leaving the env
block blank disables it (`config.webceph` falls back to empty creds).

- **Service (SSoT):** `services/webceph/webceph-service.ts` — a singleton class using
  `node-fetch` + `form-data`, with 3-attempt retry/backoff.
- **App routes:** `routes/api/media.routes.ts` (mounted under `/api`).
- **Host:** `https://api.webceph.com` (HTTPS only).
- **Official docs:** https://webceph.com/en/api/partners

> Quick-reference quirks are also captured in the `webceph-partner-api-quirks` memory.

---

## Configuration

Add to `.env` (documented in `.env.example` under "WebCeph"). Do **not** commit real
values — these are secrets.

```bash
WEBCEPH_PARTNER_API_KEY=        # partner API key issued by WebCeph
WEBCEPH_USER_EMAIL=             # the WebCeph account email (API username)
WEBCEPH_USER_API_PASSWORD=      # the account's API password (plaintext here; encrypted on the wire — see Auth)
WEBCEPH_API_BASE_URL=https://api.webceph.com
```

These map to `config.webceph.{partnerApiKey,userEmail,userApiPassword,baseUrl}`
(`config/config.ts`). Restart the server after changing them.

---

## Authentication (the part that bites)

Every request carries three headers. The catch: **WebCeph does NOT accept the plain
API password** — `X-User-ApiPass` must be the password **XOR-encrypted** (Vernam
cipher) with the key `userEmail + partnerApiKey`, then **Base64-encoded**. This is
WebCeph's `simple_encrypt(plaintext, key)` scheme, implemented in
`WebCephService.encryptApiPass()`.

| Header | Value |
|--------|-------|
| `X-Partner-ApiKey` | the partner API key (plain) |
| `X-User-ApiUsername` | the account email (plain) |
| `X-User-ApiPass` | `base64( xor(password, userEmail + partnerApiKey) )` |

```ts
// services/webceph/webceph-service.ts (abridged)
const data = Buffer.from(userApiPassword, 'utf-8');
const key  = Buffer.from(userEmail + partnerApiKey, 'utf-8');
out[i] = data[i] ^ key[i % key.length];        // XOR, repeating key
return out.toString('base64');                 // → X-User-ApiPass
```

---

## App endpoints (`/api/webceph/*`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/webceph/create-patient` | POST | Create the patient in WebCeph, then store the link locally (see DB fields). |
| `/api/webceph/upload-image` | POST (multipart) | Upload an X-ray image chosen in the browser. |
| `/api/webceph/upload-from-file` | POST | Upload an X-ray straight from the patient's server folder (no browser upload). |
| `/api/webceph/patient-link/:personId` | GET | Return the stored WebCeph link for a patient. |
| `/api/webceph/photo-types` | GET | List the valid upload target classes (see below). |

These wrap the upstream WebCeph Partner API calls the service makes:
`POST /api/v1/addnewpatient/`, `POST /api/v1/addnewpatientrecord/`,
`POST /api/v1/uploadrecordphoto/`.

### Local DB fields

`create-patient` writes back onto the `patients` row:

| Column | Notes |
|--------|-------|
| `web_ceph_patient_id` | WebCeph's patient id (the app sends `person_id` zero-padded to 6 as the WebCeph `patientid`). |
| `web_ceph_link` | The shareable record link. |
| `web_ceph_created_at` | `LOCALTIMESTAMP` of creation. |

---

## Target classes (photo types) — `GET /api/webceph/photo-types`

Codes are validated against the live API (an unknown code is rejected with "no
matching photo class"). The X-ray codes are `lateral_ceph` / `pa_ceph` / `orthopan`
— **not** the old `ceph_photo` / `pa_photo` / `pano_photo`.

| Class code | Name |
|------------|------|
| `lateral_ceph` | Lateral Cephalogram |
| `pa_ceph` | PA Cephalogram |
| `orthopan` | Panoramic |
| `eo_photo_frontal` / `eo_photo_lateral` / `eo_photo_oblique` / `eo_photo_smile` | Extra-Oral photos |
| `io_photo_frontal` / `io_photo_right` / `io_photo_left` / `io_photo_upper` / `io_photo_lower` | Intra-Oral photos |

---

## Requirements & gotchas (enforced in `validatePatientData` / `validateUploadData`)

- **Gender is required** (`male` / `female`) — WebCeph rejects an empty one with a
  cryptic "invalid format" error, so the app blocks it first.
- **Date of birth is required**, `YYYY-MM-DD`.
- **Race** must be one of `african` / `asian` / `caucasian` / `hispanic` (default `asian`).
- **Patient ID** must be 6–20 chars, or empty to let WebCeph auto-generate one.
- **Upload field name must be `file`** — WebCeph rejects `photo` with "invalid upload".
- The service retries failed requests up to 3 times with linear backoff.

---

## Troubleshooting

- **401 / auth errors** — almost always the `X-User-ApiPass` encryption (wrong key
  order, or sending the plain password). Confirm `userEmail + partnerApiKey` is the
  XOR key and the result is Base64.
- **"invalid format" on create** — a missing gender or birthday (see Requirements).
- **"no matching photo class" / "invalid upload"** — wrong `targetclass` code, or the
  image field wasn't named `file`.
- **Connection diagnostics** — the service logs at `debug` (`[WebCeph] …`) whether each
  credential is `SET`/`MISSING` without printing the secret; raise `LOG_LEVEL` to see them.
