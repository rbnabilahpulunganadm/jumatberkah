// Konfigurasi
const CONFIG = {
  sheetName: 'Data Reservasi Jumat Berkah',
  sheetHeaders: [
    'Timestamp', 'ID Reservasi', 'Nama Pemesan', 'NIK', 'No HP', 
    'Alamat', 'Nama Anak', 'Tanggal Lahir Anak', 'Treatment', 
    'Jam Kedatangan', 'Keluhan', 'Terapis'
  ]
};

// Fungsi utama untuk menangani request POST (mengirim data)
function doPost(e) {
  // LockService untuk mencegah race condition (beberapa submit bersamaan)
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // Tunggu hingga 30 detik jika ada proses lain

  try {
    const data = JSON.parse(e.postData.contents);
    return handleReservation(data);
  } catch (error) {
    return createJsonResponse('error', null, error.message);
  } finally {
    lock.releaseLock(); // Selalu lepaskan kunci setelah selesai
  }
}

// Fungsi utama untuk menangani request GET (mengambil data)
function doGet(e) {
  try {
    const action = e.parameter.action;
    switch (action) {
      case 'getData':
        return getReservationData();
      case 'getRegistrants':
        return getRegistrantsData();
      case 'checkDuplicate':
        return checkDuplicateRegistration(e.parameter);
      default:
        return createJsonResponse('error', null, 'Action tidak dikenali');
    }
  } catch (error) {
    return createJsonResponse('error', null, error.message);
  }
}

// Fungsi terpusat untuk membuat response JSON
function createJsonResponse(result, data = null, error = null) {
  const response = { result, data, error };
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimetype(ContentService.MimeType.JSON);
}

// Fungsi untuk mendapatkan atau membuat sheet jika belum ada
function getOrCreateSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(CONFIG.sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.sheetName);
    const headers = [CONFIG.sheetHeaders];
    sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Atur lebar kolom
    const widths = [150, 150, 180, 150, 120, 250, 180, 120, 250, 120, 300, 120];
    widths.forEach((width, i) => sheet.setColumnWidth(i + 1, width));
  }
  return sheet;
}

// Fungsi untuk menangani data reservasi baru
function handleReservation(data) {
  const sheet = getOrCreateSheet();
  
  // Validasi data yang wajib diisi
  const requiredFields = ['namaPemesan', 'nik', 'noHp', 'alamat', 'namaAnak', 'tglLahir', 'treatment', 'jamKedatangan'];
  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`Field wajib diisi: ${field}`);
    }
  }

  // Cek duplikasi data sebelum menyimpan
  const existingData = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.sheetHeaders.length).getValues() : [];
  const isDuplicate = existingData.some(row => 
    row[2] === data.namaPemesan || row[3] === data.nik || row[4] === data.noHp
  );
  
  if (isDuplicate) {
    // Kirim pesan error yang spesifik agar bisa ditangkap oleh client-side
    throw new Error('duplicate: Anda sudah terdaftar. Setiap orang hanya dapat mendaftar satu kali (berdasarkan NIK, No HP, dan Nama).');
  }

  // Generate ID Reservasi
  const reservationId = 'JBKNP-' + new Date().getTime().toString().slice(-6);

  // Simpan data ke baris baru
  const newRow = [
    new Date(), reservationId, data.namaPemesan, data.nik, data.noHp, 
    data.alamat, data.namaAnak, data.tglLahir, data.treatment, 
    data.jamKedatangan, data.keluhan || '', 'Akan Ditentukan'
  ];
  sheet.appendRow(newRow);
  
  return createJsonResponse('success', { reservationId, message: 'Reservasi berhasil disimpan' });
}

// Fungsi untuk mengambil data kuota terkini
function getReservationData() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  const treatmentCounts = {};
  const timeSlotCounts = {};

  if (lastRow > 1) {
    const dataRange = sheet.getRange(2, 9, lastRow - 1, 2).getValues(); // Kolom Treatment (9) dan Jam (10)
    dataRange.forEach(([treatment, timeSlot]) => {
      if (treatment) treatmentCounts[treatment] = (treatmentCounts[treatment] || 0) + 1;
      if (timeSlot) timeSlotCounts[timeSlot] = (timeSlotCounts[timeSlot] || 0) + 1;
    });
  }
  
  return createJsonResponse('success', { treatmentCounts, timeSlotCounts });
}

// Fungsi untuk mengambil daftar pendaftar terbaru
function getRegistrantsData() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return createJsonResponse('success', []);

  const data = sheet.getRange(2, 1, lastRow - 1, CONFIG.sheetHeaders.length).getValues();
  const registrants = data.map(row => ({
    timestamp: row[0], idReservasi: row[1], namaPemesan: row[2], nik: row[3],
    noHp: row[4], alamat: row[5], namaAnak: row[6], tglLahir: row[7],
    treatment: row[8], jamKedatangan: row[9], keluhan: row[10]
  })).reverse(); // Data terbaru di atas

  // Batasi hanya 20 data terbaru untuk performa
  return createJsonResponse('success', registrants.slice(0, 20));
}

// Fungsi untuk memeriksa duplikasi data dari form secara real-time
function checkDuplicateRegistration(params) {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return createJsonResponse('success', { isDuplicate: false });

  const data = sheet.getRange(2, 3, lastRow - 1, 3).getValues(); // Kolom Nama (3), NIK (4), No HP (5)
  const isDuplicate = data.some(([nama, nik, noHp]) => 
    (params.namaPemesan && nama === params.namaPemesan) ||
    (params.nik && nik === params.nik) ||
    (params.noHp && noHp === params.noHp)
  );

  return createJsonResponse('success', { isDuplicate });
}
