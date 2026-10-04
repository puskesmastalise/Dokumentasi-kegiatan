"use strict";
const $ = (id) => document.getElementById(id);
let cluster = "",
  files = [],
  busy = false,
  connected = false,
  endpoint =
    localStorage.getItem("documenta.endpoint") ||
    window.DOKUMENTA_CONFIG?.appsScriptUrl ||
    "",
  key = "",
  batch = null,
  records = [],
  reading = false,
  historyToken = "",
  historyGeneration = 0;
const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const modal = (icon, title, text) =>
  Swal.fire({
    icon,
    title,
    text,
    confirmButtonColor: "#2855dc",
    confirmButtonText: "Mengerti",
  });
$("date").textContent = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "long",
  timeZone: "Asia/Makassar",
}).format(new Date());
for (let i = 1; i <= 5; i++) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cluster";
  b.innerHTML = "<span>▱</span>Klaster " + i;
  b.setAttribute("aria-pressed", "false");
  b.onclick = () => {
    if (busy || batch) return;
    cluster = "Klaster " + i;
    document.querySelectorAll(".cluster").forEach((x) => {
      x.classList.toggle("selected", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    update();
  };
  document.querySelector(".clusters").append(b);
}
function update() {
  $("treeCluster").textContent = cluster || "Pilih klaster";
  $("treeFolder").textContent =
    $("folder").value.trim() || "Nama folder dokumentasi";
  $("treePhotos").textContent = files.length
    ? files.length + " foto kegiatan"
    : "Foto kegiatan";
  $("counter").textContent = files.length + " / 20 foto";
  $("selectionInfo").textContent = files.length
    ? files.length + " foto siap disimpan"
    : "Belum ada foto dipilih";
  $("thumbnails").replaceChildren();
  files.forEach((f, i) => {
    const d = document.createElement("div");
    d.className = "thumbnail";
    const img = document.createElement("img");
    img.src = f.url;
    img.alt = f.file.name;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.setAttribute("aria-label", "Hapus " + f.file.name);
    rm.disabled = busy || !!batch;
    rm.onclick = () => {
      URL.revokeObjectURL(f.url);
      files.splice(i, 1);
      update();
    };
    const name = document.createElement("small");
    name.textContent = f.file.name;
    d.append(img, rm, name);
    $("thumbnails").append(d);
  });
}
$("folder").oninput = update;
async function addFiles(items) {
  if (busy || batch) return;
  const incoming = Array.from(items);
  if (incoming.length + files.length > 20)
    return modal(
      "warning",
      "Maksimal 20 foto",
      "Pilih paling banyak 20 foto untuk satu dokumentasi.",
    );
  const bad = incoming.find(
    (f) =>
      !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
      f.size > 10 * 1024 * 1024,
  );
  if (bad)
    return modal(
      "warning",
      "Foto belum dapat ditambahkan",
      "Gunakan JPG, PNG, atau WEBP berukuran maksimal 10 MB per foto.",
    );
  try {
    for (const f of incoming) {
      const image = await createImageBitmap(f);
      image.close();
    }
  } catch {
    return modal(
      "warning",
      "Foto tidak dapat dibaca",
      "Pilih file foto JPG, PNG, atau WEBP yang tidak rusak.",
    );
  }
  incoming.forEach((f) => {
    if (
      !files.some(
        (x) =>
          x.file.name === f.name &&
          x.file.size === f.size &&
          x.file.lastModified === f.lastModified,
      )
    )
      files.push({ file: f, url: URL.createObjectURL(f) });
  });
  update();
}
$("photos").onchange = (e) => {
  addFiles(e.target.files);
  e.target.value = "";
};
$("dropzone").onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("photos").click();
  }
};
["dragover", "dragleave", "drop"].forEach((name) =>
  $("dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("dropzone").classList.toggle("drag", name === "dragover");
    if (name === "drop") addFiles(e.dataTransfer.files);
  }),
);
function openConfig() {
  if (busy) return;
  $("endpoint").value = endpoint;
  $("accessKey").value = key;
  $("configError").textContent = "";
  $("config").showModal();
}
$("settings").onclick = openConfig;
$("connect").onclick = openConfig;
$("connection").onclick = openConfig;
$("connection").style.cursor = "pointer";
$("closeConfig").onclick = () => $("config").close();
async function api(action, data = {}) {
  if (!endpoint || !key)
    throw Error("Hubungkan Google Sheets dan Drive terlebih dahulu.");
  let r;
  try {
    r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, key, ...data }),
      redirect: "follow",
      signal: AbortSignal.timeout(90000),
    });
  } catch (e) {
    throw Error(
      "Konfirmasi server belum diterima. Periksa koneksi, lalu coba lagi; pengiriman yang sama akan dilanjutkan.",
    );
  }
  let v;
  try {
    v = await r.json();
  } catch {
    throw Error(
      "Respons bukan data aplikasi. Periksa URL /exec dan akses deployment pada panduan aktivasi.",
    );
  }
  if (!v.ok) {
    const err = new Error(v.message || "Penyimpanan belum berhasil.");
    err.code = v.code;
    throw err;
  }
  return v.data;
}
$("configForm").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("endpoint").value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    $("configError").textContent =
      "Gunakan URL deployment Google Apps Script yang berakhir /exec.";
    return;
  }
  const old = { endpoint, key };
  endpoint = url;
  key = $("accessKey").value.trim();
  $("testConnection").disabled = true;
  try {
    await api("ping");
    connected = true;
    localStorage.setItem("documenta.endpoint", endpoint);
    $("connection").textContent = "Penyimpanan terhubung";
    $("connection").classList.add("online");
    $("notice").hidden = true;
    $("config").close();
    lockHistory();
    view(false);
  } catch (err) {
    endpoint = old.endpoint;
    key = old.key;
    $("configError").textContent = err.message;
  } finally {
    $("testConnection").disabled = false;
  }
};
function lockHistory() {
  historyToken = "";
  historyGeneration++;
  records = [];
  $("records").replaceChildren();
  $("filter").value = "";
}
function view(history) {
  if (history && !historyToken) return;
  if (!history) lockHistory();
  $("formView").hidden = history;
  $("historyView").hidden = !history;
  $("formNav").classList.toggle("active", !history);
  $("historyNav").classList.toggle("active", history);
  $("crumb").textContent = history
    ? "Riwayat dokumentasi"
    : "Dokumentasi kegiatan";
  $("title").textContent = history
    ? "Setiap kegiatan, tercatat."
    : "Dokumentasikan kegiatan.";
  $("subtitle").textContent = history
    ? "Temukan kembali dokumentasi yang tersimpan di Google Drive."
    : "Simpan momen kegiatan, tersusun rapi dalam setiap klaster.";
  if (history && connected) loadRecords();
}
$("formNav").onclick = () => view(false);
$("historyNav").onclick = openHistory;
$("filter").onchange = renderRecords;
$("refresh").onclick = () => (connected ? loadRecords() : openConfig());
async function openHistory() {
  if (busy) return;
  if (historyToken) {
    view(true);
    return;
  }
  const result = await Swal.fire({
    title: "Buka riwayat dokumentasi",
    text: "Masukkan PIN untuk melihat dokumentasi tersimpan.",
    input: "password",
    inputLabel: "PIN riwayat",
    inputPlaceholder: "6–12 digit",
    inputAttributes: {
      inputmode: "numeric",
      maxlength: "12",
      autocomplete: "off",
    },
    showCancelButton: true,
    confirmButtonText: "Buka riwayat",
    cancelButtonText: "Batal",
    confirmButtonColor: "#2855dc",
    showLoaderOnConfirm: true,
    allowOutsideClick: () => !Swal.isLoading(),
    preConfirm: async (pin) => {
      if (!/^\d{6,12}$/.test(pin)) {
        Swal.showValidationMessage("Masukkan PIN berupa 6–12 angka.");
        return false;
      }
      if (!connected) {
        Swal.showValidationMessage(
          "Hubungkan penyimpanan melalui Pengaturan koneksi terlebih dahulu.",
        );
        return false;
      }
      try {
        const auth = await api("unlockHistory", { pin });
        if (typeof auth.token !== "string" || !auth.token)
          throw Error(
            "Perbarui Code.gs dan deployment Apps Script untuk mengaktifkan PIN.",
          );
        return auth.token;
      } catch (e) {
        Swal.showValidationMessage(e.message);
        return false;
      }
    },
  });
  if (result.isConfirmed && result.value) {
    historyToken = result.value;
    historyGeneration++;
    view(true);
  }
}
$("lockHistory").onclick = () => view(false);
function safeDrive(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "drive.google.com"
      ? u.href
      : "#";
  } catch {
    return "#";
  }
}
function renderRecords() {
  const list = records.filter(
    (x) => !$("filter").value || x.cluster === $("filter").value,
  );
  $("records").innerHTML = list.length
    ? list
        .map(
          (x) =>
            '<div class="record"><div><strong>' +
            escapeHTML(x.name) +
            "</strong><small>" +
            escapeHTML(x.cluster) +
            " · " +
            escapeHTML(x.count) +
            " foto · " +
            escapeHTML(
              new Date(x.created).toLocaleString("id-ID", {
                timeZone: "Asia/Makassar",
              }),
            ) +
            ' WITA</small></div><a href="' +
            escapeHTML(safeDrive(x.url)) +
            '" target="_blank" rel="noopener">Buka folder ↗</a></div>',
        )
        .join("")
    : '<div class="empty">▤<h3>Belum ada dokumentasi</h3><p>Dokumentasi yang selesai disimpan akan muncul di sini.</p></div>';
}
async function loadRecords() {
  if (reading || !historyToken) return;
  const generation = historyGeneration;
  reading = true;
  $("refresh").disabled = true;
  try {
    const data = await api("list", { historyToken });
    if (generation !== historyGeneration) return;
    records = data.records;
    renderRecords();
    $("syncStatus").textContent =
      "Diperbarui " +
      new Date().toLocaleTimeString("id-ID") +
      " · Otomatis setiap 30 detik saat halaman ini aktif.";
  } catch (e) {
    if (generation !== historyGeneration) return;
    if (e.code === "HISTORY_LOCKED") {
      view(false);
      modal("info", "Riwayat terkunci", e.message);
    } else $("syncStatus").textContent = "Pembaruan gagal: " + e.message;
  } finally {
    reading = false;
    $("refresh").disabled = false;
  }
}
setInterval(() => {
  if (connected && !busy && !document.hidden && !$("historyView").hidden)
    loadRecords();
}, 30000);
async function encode(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bitmap.width * scale));
  c.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const blob = await new Promise((resolve) =>
    c.toBlob(resolve, "image/jpeg", 0.84),
  );
  if (!blob || blob.size > 4 * 1024 * 1024)
    throw Error(
      "Foto terlalu besar setelah dioptimalkan. Pilih foto yang lebih kecil.",
    );
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
function progress(n, text) {
  $("progressWrap").hidden = false;
  $("bar").style.width = n + "%";
  $("progressText").textContent = text;
}
function lock(on) {
  busy = on;
  $("save").disabled = on;
  $("folder").disabled = on || !!batch;
  $("photos").disabled = on || !!batch;
  document
    .querySelectorAll(".cluster")
    .forEach((b) => (b.disabled = on || !!batch));
  update();
}
$("report").onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  if (!connected) {
    openConfig();
    return;
  }
  const name = $("folder").value.trim();
  if (!cluster || !name || !files.length) {
    modal(
      "warning",
      "Lengkapi dokumentasi",
      "Pilih klaster, isi nama folder, dan tambahkan minimal 1 foto.",
    );
    return;
  }
  if (/[\/\\\u0000-\u001f]/.test(name)) {
    modal(
      "warning",
      "Periksa nama folder",
      "Nama folder tidak boleh berisi garis miring atau karakter kontrol.",
    );
    return;
  }
  if (!batch)
    batch = { id: crypto.randomUUID(), cluster, name, count: files.length };
  lock(true);
  try {
    progress(2, "Menyiapkan folder dokumentasi…");
    const start = await api("begin", batch);
    if (!start.complete) {
      for (let i = 0; i < files.length; i++) {
        progress(
          5 + Math.round((i / files.length) * 88),
          "Mengirim foto " + (i + 1) + " dari " + files.length + "…",
        );
        if (!files[i].encoded) files[i].encoded = await encode(files[i].file);
        await api("photo", { id: batch.id, index: i, data: files[i].encoded });
      }
    }
    progress(96, "Mencatat dokumentasi di Google Sheets…");
    await api("commit", { id: batch.id });
    progress(100, "Seluruh foto dan rekap berhasil disimpan.");
    files.forEach((f) => URL.revokeObjectURL(f.url));
    files = [];
    batch = null;
    $("folder").value = "";
    $("save").textContent = "Simpan dokumentasi";
    await Swal.fire({
      icon: "success",
      title: "Berhasil tersimpan",
      confirmButtonText: "OK",
      confirmButtonColor: "#2855dc",
    });
  } catch (err) {
    $("save").textContent = "Lanjutkan penyimpanan";
    await modal(
      "error",
      "Penyimpanan belum terkonfirmasi",
      err.message +
        " Foto dan isian tetap tersedia. Klik Lanjutkan penyimpanan untuk melanjutkan tanpa menggandakan kiriman.",
    );
  } finally {
    lock(false);
  }
};
window.addEventListener("beforeunload", (e) => {
  if (busy || batch) {
    e.preventDefault();
    e.returnValue = "";
  }
});
