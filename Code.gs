/** Dokumenta — backend Google Apps Script. Jalankan setup() satu kali. */
const ROOT_FOLDER_ID = "1DY921amTXL9poEJEQUescpRzcVRN0CUO";
const HEADERS = [
  "ID",
  "Waktu",
  "Klaster",
  "Nama Folder",
  "Jumlah Foto",
  "Folder ID",
  "Tautan Drive",
  "Status",
];
function setup() {
  const p = PropertiesService.getScriptProperties();
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  root.getName();
  if (!p.getProperty("ACCESS_KEY"))
    p.setProperty("ACCESS_KEY", Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty("SPREADSHEET_ID")) {
    const book = SpreadsheetApp.create("Rekap Dokumentasi Kegiatan - Talise");
    p.setProperty("SPREADSHEET_ID", book.getId());
  }
  const book = SpreadsheetApp.openById(p.getProperty("SPREADSHEET_ID"));
  for (let i = 1; i <= 5; i++) {
    const name = "Klaster " + i;
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    if (!sheet.getLastRow()) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
      sheet
        .getRange(1, 1, 1, 8)
        .setBackground("#2855dc")
        .setFontColor("#ffffff")
        .setFontWeight("bold");
      sheet.setColumnWidths(1, 8, 170);
      sheet.setColumnWidth(4, 300);
    }
    const folders = root.getFoldersByName(name);
    if (!folders.hasNext()) root.createFolder(name);
  }
  console.log("Siap. Buka Spreadsheet: " + book.getUrl());
  console.log(
    "Kunci akses tersedia pada Project Settings > Script Properties > ACCESS_KEY.",
  );
}
function doGet() {
  return ContentService.createTextOutput(
    "Dokumenta backend aktif. Gunakan aplikasi untuk mengakses data.",
  );
}
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 6000000)
      throw Error("Permintaan tidak valid atau terlalu besar.");
    const p = JSON.parse(e.postData.contents),
      props = PropertiesService.getScriptProperties();
    const secret = props.getProperty("ACCESS_KEY");
    if (!secret || typeof p.key !== "string" || p.key !== secret)
      throw Error("Kunci akses tidak valid.");
    if (!props.getProperty("SPREADSHEET_ID"))
      throw Error("Jalankan setup terlebih dahulu.");
    lock = LockService.getScriptLock();
    lock.waitLock(25000);
    return output_({ ok: true, data: handle_(p, props) });
  } catch (err) {
    return output_({
      ok: false,
      message: String(err.message || err),
      code: err.code || null,
    });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}
function output_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function text_(s) {
  return /^[=+@-]/.test(s) ? "'" + s : s;
}
function find_(book, id) {
  for (let n = 1; n <= 5; n++) {
    const sheet = book.getSheetByName("Klaster " + n);
    if (!sheet) continue;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++)
      if (String(data[i][0]) === id)
        return { sheet, row: i + 1, data: data[i] };
  }
  return null;
}
function handle_(p, props) {
  const book = SpreadsheetApp.openById(props.getProperty("SPREADSHEET_ID"));
  if (p.action === "ping") {
    DriveApp.getFolderById(ROOT_FOLDER_ID).getName();
    return {
      connected: true,
      historyPinEnabled: /^\d{6,12}$/.test(
        props.getProperty("HISTORY_PIN") || "",
      ),
    };
  }
  if (p.action === "unlockHistory") return unlockHistory_(p, props);
  if (p.action === "list") {
    requireHistory_(p, props);
    let all = [];
    for (let n = 1; n <= 5; n++) {
      const s = book.getSheetByName("Klaster " + n);
      if (!s) continue;
      all = all.concat(
        s
          .getDataRange()
          .getValues()
          .slice(1)
          .filter((r) => r[7] === "SELESAI")
          .map((r) => ({
            id: r[0],
            created: r[1] instanceof Date ? r[1].toISOString() : r[1],
            cluster: r[2],
            name: String(r[3]).replace(/^'/, ""),
            count: r[4],
            url: r[6],
          })),
      );
    }
    all.sort((a, b) => new Date(b.created) - new Date(a.created));
    return { records: all };
  }
  if (!/^[a-f0-9-]{36}$/.test(String(p.id || "")))
    throw Error("ID pengiriman tidak valid.");
  let rec = find_(book, p.id);
  if (p.action === "begin") {
    if (
      !/^Klaster [1-5]$/.test(p.cluster) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 100 ||
      /[\/\\\u0000-\u001f]/.test(p.name) ||
      !Number.isInteger(p.count) ||
      p.count < 1 ||
      p.count > 20
    )
      throw Error("Klaster, nama folder, atau jumlah foto tidak valid.");
    if (rec) {
      if (
        rec.data[2] !== p.cluster ||
        String(rec.data[3]).replace(/^'/, "") !== p.name ||
        Number(rec.data[4]) !== p.count
      )
        throw Error("Data kiriman berbeda.");
      return { complete: rec.data[7] === "SELESAI" };
    }
    const root = DriveApp.getFolderById(ROOT_FOLDER_ID),
      groups = root.getFoldersByName(p.cluster),
      group = groups.hasNext() ? groups.next() : root.createFolder(p.cluster);
    // Folder sementara unik agar retry aman jika appendRow gagal setelah folder dibuat.
    const staging = "Dokumenta-pending-" + p.id,
      existing = group.getFoldersByName(staging),
      folder = existing.hasNext()
        ? existing.next()
        : group.createFolder(staging);
    const s = book.getSheetByName(p.cluster);
    if (!s) throw Error("Jalankan setup untuk membuat sheet klaster.");
    s.appendRow([
      p.id,
      new Date().toISOString(),
      p.cluster,
      text_(p.name),
      p.count,
      folder.getId(),
      folder.getUrl(),
      "PROSES",
    ]);
    SpreadsheetApp.flush();
    return { complete: false };
  }
  if (!rec)
    throw Error("Kiriman tidak ditemukan. Mulai kembali dari formulir.");
  const folder = DriveApp.getFolderById(rec.data[5]);
  if (p.action === "photo") {
    if (
      !Number.isInteger(p.index) ||
      p.index < 0 ||
      p.index >= Number(rec.data[4])
    )
      throw Error("Nomor foto tidak valid.");
    const filename = String(p.index + 1).padStart(2, "0") + ".jpg";
    if (folder.getFilesByName(filename).hasNext()) return { saved: true };
    if (rec.data[7] === "SELESAI") throw Error("Dokumentasi telah selesai.");
    if (
      typeof p.data !== "string" ||
      p.data.length > 5600000 ||
      !/^\/9j\//.test(p.data)
    )
      throw Error("Data foto JPEG tidak valid.");
    const bytes = Utilities.base64Decode(p.data);
    if (bytes.length > 4 * 1024 * 1024 || bytes.length < 4)
      throw Error("Ukuran foto tidak valid.");
    folder.createFile(Utilities.newBlob(bytes, "image/jpeg", filename));
    return { saved: true };
  }
  if (p.action === "commit") {
    for (let i = 1; i <= Number(rec.data[4]); i++)
      if (!folder.getFilesByName(String(i).padStart(2, "0") + ".jpg").hasNext())
        throw Error(
          "Belum semua foto tersimpan. Silakan lanjutkan penyimpanan.",
        );
    folder.setName(String(rec.data[3]).replace(/^'/, ""));
    rec.sheet.getRange(rec.row, 8).setValue("SELESAI");
    SpreadsheetApp.flush();
    return { url: folder.getUrl(), id: p.id };
  }
  throw Error("Operasi tidak dikenal.");
}

// Atur HISTORY_PIN (6–12 angka) di Project Settings > Script Properties.
// PIN tidak dikirim ke frontend atau ditulis ke paket aplikasi.
function historyHash_(pin) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin),
  );
}
function historyError_(message) {
  const e = new Error(message);
  e.code = "HISTORY_LOCKED";
  return e;
}
function unlockHistory_(p, props) {
  const pin = props.getProperty("HISTORY_PIN") || "";
  if (!/^\d{6,12}$/.test(pin))
    throw Error(
      "PIN belum diatur. Pengelola perlu menambahkan HISTORY_PIN di Script Properties.",
    );
  const now = Date.now();
  const state = JSON.parse(
    props.getProperty("HISTORY_PIN_ATTEMPTS") || '{"count":0,"until":0}',
  );
  if (state.until > now)
    throw Error(
      "Terlalu banyak PIN salah. Coba lagi dalam " +
        Math.ceil((state.until - now) / 60000) +
        " menit.",
    );
  if (state.until && state.until <= now) {
    state.count = 0;
    state.until = 0;
  }
  if (typeof p.pin !== "string" || p.pin !== pin) {
    state.count++;
    if (state.count >= 5) state.until = now + 5 * 60 * 1000;
    props.setProperty("HISTORY_PIN_ATTEMPTS", JSON.stringify(state));
    throw Error(
      state.until
        ? "PIN salah 5 kali. Riwayat dikunci selama 5 menit."
        : "PIN salah. Silakan coba lagi.",
    );
  }
  props.deleteProperty("HISTORY_PIN_ATTEMPTS");
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put("history:" + token, historyHash_(pin), 900);
  return { token, expiresIn: 900 };
}
function requireHistory_(p, props) {
  if (
    typeof p.historyToken !== "string" ||
    !/^[a-f0-9-]{72}$/.test(p.historyToken)
  )
    throw historyError_("Masukkan PIN untuk membuka riwayat.");
  const pin = props.getProperty("HISTORY_PIN") || "";
  const session = CacheService.getScriptCache().get(
    "history:" + p.historyToken,
  );
  if (!session || !pin || session !== historyHash_(pin))
    throw historyError_("Sesi riwayat berakhir. Silakan masukkan PIN kembali.");
}
