// Darrel Petties site — ministry intake endpoint.
//
// Backs the two-step footer form and writes to the Client-DarrelPetties
// "Bookings" table. The Airtable token is read from the AIRTABLE_TOKEN
// environment variable (set in Netlify) and never ships to the browser.
//
//   POST { step: "email",   email }                  -> { ok, id }
//        creates the row immediately, Stage "Email only", so an abandoned
//        second step still leaves a real lead behind.
//   POST { step: "details", id, email, ...fields }   -> { ok, id }
//        patches that row and flips Stage to "Completed". The id alone is not
//        enough: the row's Email must match the submitted one, so a guessed or
//        replayed id cannot overwrite somebody else's inquiry. If the id is
//        missing or fails that check, the details land in a fresh row rather
//        than being dropped.
//
// Env vars (Netlify -> Site settings -> Environment variables):
//   AIRTABLE_TOKEN     (required) — PAT with data.records:read + data.records:write on the base
//   AIRTABLE_BASE_ID   (optional) — defaults to the Client-DarrelPetties base below
//   AIRTABLE_TABLE     (optional) — defaults to "Bookings"

const AIRTABLE_API = 'https://api.airtable.com/v0';
const DEFAULT_BASE = 'appnwq20GTzMqYBN4'; // Client-DarrelPetties (base IDs are not secret)
const DEFAULT_TABLE = 'Bookings';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_RE = /^rec[A-Za-z0-9]{14}$/;
const BOOKING_TYPES = [
  'Revival',
  'Conference',
  'Musical',
  'Consecration',
  'Church anniversary',
  'Speaking engagement',
  'Other',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const reply = (statusCode, obj) => ({ statusCode, headers: CORS, body: JSON.stringify(obj) });
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function airtable(path, token, init) {
  return fetch(`${AIRTABLE_API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...((init && init.headers) || {}),
    },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method not allowed' });

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { ok: false, error: 'Malformed request' }); }

  // The form ships a hidden trap field. A filled trap used to mean "drop it
  // silently", but browser autofill and password managers fill hidden inputs
  // too — a human whose manager typed into it lost their inquiry and still saw
  // a success screen. Now the row is written and flagged for review instead, so
  // a false positive costs a checkbox rather than a lead. `company` is the old
  // trap name, still honoured for pages served from cache.
  const trapped = Boolean(clean(data.hp, 200) || clean(data.company, 200));
  if (trapped) console.warn('Intake trap field filled — saving flagged.');

  const email = clean(data.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return reply(400, { ok: false, error: 'Please enter a valid email address.' });

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    console.error('AIRTABLE_TOKEN is not set — the intake form cannot save.');
    return reply(500, { ok: false, error: 'The form is not connected yet. Please email the ministry office.' });
  }
  const baseId = process.env.AIRTABLE_BASE_ID || DEFAULT_BASE;
  const table = encodeURIComponent(process.env.AIRTABLE_TABLE || DEFAULT_TABLE);
  const source = clean(data.source, 100) || 'Footer intake';

  // ---- step 1: email only ----
  if (data.step !== 'details') {
    try {
      const res = await airtable(`${baseId}/${table}`, token, {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            Name: email, Email: email, Source: source,
            Stage: 'Email only', Status: 'New', Flagged: trapped,
          },
        }),
      });
      if (!res.ok) {
        console.error('Airtable create failed', res.status, await res.text().catch(() => ''));
        return reply(502, { ok: false, error: 'We could not save that. Please try again.' });
      }
      const rec = await res.json();
      return reply(200, { ok: true, id: rec.id });
    } catch (err) {
      console.error('Airtable create threw', err);
      return reply(502, { ok: false, error: 'We could not save that. Please try again.' });
    }
  }

  // ---- step 2: the details ----
  const name = clean(data.name, 200);
  const bookingType = BOOKING_TYPES.includes(data.bookingType) ? data.bookingType : null;
  const eventDate = DATE_RE.test(clean(data.eventDate, 10)) ? clean(data.eventDate, 10) : null;

  const fields = {
    Name: name || email,
    Email: email,
    Source: source,
    Stage: 'Completed',
    Status: 'New',
    Flagged: trapped,
  };
  if (bookingType) fields['Booking Type'] = bookingType;
  if (eventDate) fields['Event Date'] = eventDate;
  const organization = clean(data.organization, 200);
  const phone = clean(data.phone, 40);
  const message = clean(data.message, 5000);
  if (organization) fields.Organization = organization;
  if (phone) fields.Phone = phone;
  if (message) fields.Message = message;

  const id = clean(data.id, 30);
  try {
    if (RECORD_RE.test(id)) {
      // Only patch a row that already belongs to this email address.
      const check = await airtable(`${baseId}/${table}/${id}`, token, { method: 'GET' });
      if (check.ok) {
        const rec = await check.json();
        const onFile = String((rec.fields && rec.fields.Email) || '').toLowerCase();
        if (onFile === email) {
          const res = await airtable(`${baseId}/${table}/${id}`, token, {
            method: 'PATCH',
            body: JSON.stringify({ fields }),
          });
          if (res.ok) return reply(200, { ok: true, id });
          console.error('Airtable patch failed', res.status, await res.text().catch(() => ''));
        }
      }
    }
    // No usable id — never drop the details, just start a new row.
    const res = await airtable(`${baseId}/${table}`, token, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      console.error('Airtable create (details) failed', res.status, await res.text().catch(() => ''));
      return reply(502, { ok: false, error: 'We could not send that. Please try again.' });
    }
    const rec = await res.json();
    return reply(200, { ok: true, id: rec.id });
  } catch (err) {
    console.error('Airtable details threw', err);
    return reply(502, { ok: false, error: 'We could not send that. Please try again.' });
  }
};
