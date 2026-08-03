const axios = require('axios');
const { pool } = require('../config/database');

const WAHA_URL = process.env.WAHA_API_URL || '';
const WAHA_KEY = process.env.WAHA_API_KEY || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

// Convert Indonesian phone number to WAHA chatId format
function formatPhone(phone) {
  let n = phone.replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.substring(1);
  if (!n.startsWith('62')) n = '62' + n;
  return n + '@c.us';
}

// Send a text message via WAHA
async function sendWA(phone, text) {
  if (!WAHA_URL) return false;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_KEY) headers['Authorization'] = `Bearer ${WAHA_KEY}`;
    await axios.post(`${WAHA_URL}/api/sendText`, {
      chatId: formatPhone(phone),
      text,
      session: WAHA_SESSION
    }, { headers, timeout: 15000 });
    return true;
  } catch (e) {
    console.error('[WA]', e.message);
    return false;
  }
}

// Replace placeholders in template
function fill(tpl, d) {
  return tpl
    .replace(/\{nama_wali\}/g, d.nama_wali || '-')
    .replace(/\{nama_anak\}/g, d.nama_anak || '-')
    .replace(/\{nama_panggilan\}/g, d.nama_panggilan || '-')
    .replace(/\{kegiatan\}/g, d.kegiatan || '-')
    .replace(/\{kelompok\}/g, d.kelompok || '-')
    .replace(/\{tanggal\}/g, d.tanggal || '-')
    .replace(/\{waktu\}/g, d.waktu || '-');
}

// Get template: user-specific → global → hardcoded
async function getTemplate(userId, type) {
  if (userId) {
    const r = await pool.query('SELECT template_text FROM message_templates WHERE user_id=$1 AND type=$2', [userId, type]);
    if (r.rows.length) return r.rows[0].template_text;
  }
  const r = await pool.query('SELECT template_text FROM message_templates WHERE user_id IS NULL AND type=$1', [type]);
  if (r.rows.length) return r.rows[0].template_text;

  // Hardcoded fallback
  if (type === 'attendance') {
    return "Assalamu'alaikum Bapak/Ibu {nama_wali},\n\nPutra/putri Bapak/Ibu yang bernama {nama_anak} telah hadir dalam kegiatan {kegiatan} - {kelompok} di Masjid Jogokariyan pada {tanggal} pukul {waktu}.\n\nJazakumullahu khairan.\n🕌 RMJ Masjid Jogokariyan";
  }
  return "Assalamu'alaikum Bapak/Ibu {nama_wali},\n\nKegiatan {kegiatan} - {kelompok} pada {tanggal} telah selesai. Putra/putri {nama_anak} sudah bisa dijemput.\n\nJazakumullahu khairan.\n🕌 RMJ Masjid Jogokariyan";
}

function formatTanggal() {
  return new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatWaktu() {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
}

// Send attendance notification
async function sendAttendance(userId, participant, activityName, groupName) {
  if (!participant.guardian_whatsapp) return false;
  const tpl = await getTemplate(userId, 'attendance');
  const msg = fill(tpl, {
    nama_wali: participant.guardian_name,
    nama_anak: participant.full_name,
    nama_panggilan: participant.nickname,
    kegiatan: activityName,
    kelompok: groupName,
    tanggal: formatTanggal(),
    waktu: formatWaktu()
  });
  return sendWA(participant.guardian_whatsapp, msg);
}

// Send session-end notification
async function sendSessionEnd(userId, participant, activityName, groupName) {
  if (!participant.guardian_whatsapp) return false;
  const tpl = await getTemplate(userId, 'session_end');
  const msg = fill(tpl, {
    nama_wali: participant.guardian_name,
    nama_anak: participant.full_name,
    nama_panggilan: participant.nickname,
    kegiatan: activityName,
    kelompok: groupName,
    tanggal: formatTanggal(),
    waktu: formatWaktu()
  });
  return sendWA(participant.guardian_whatsapp, msg);
}

// Send a test message and return detailed success/error info (for Settings > Test WA)
async function sendTest(phone) {
  if (!WAHA_URL) {
    return { success: false, error: 'WAHA_API_URL belum dikonfigurasi di environment variable server.' };
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_KEY) headers['Authorization'] = `Bearer ${WAHA_KEY}`;
    const testMsg = `🧪 Ini adalah pesan *test* dari Sistem Absensi.\n\nJika Anda menerima pesan ini, konfigurasi WhatsApp sudah berjalan dengan baik.\n\nDikirim: ${formatTanggal()}, ${formatWaktu()} WIB`;
    await axios.post(`${WAHA_URL}/api/sendText`, {
      chatId: formatPhone(phone),
      text: testMsg,
      session: WAHA_SESSION
    }, { headers, timeout: 15000 });
    return { success: true };
  } catch (e) {
    const errMsg = e.response?.data?.message || e.response?.data?.error || e.message;
    console.error('[WA TEST]', errMsg);
    return { success: false, error: errMsg };
  }
}

module.exports = { sendAttendance, sendSessionEnd, getTemplate, fill, sendWA, sendTest };
