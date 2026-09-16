(function () {
  const SPLASH_MS = 2600;
  const MAX_PHOTOS = 3;
  const MONTHS = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    hi: ["जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितम्बर", "अक्टूबर", "नवम्बर", "दिसम्बर"]
  };

  const API = {
    districts: "https://urbangis.mp.gov.in/api/Plantation/GetDistrict",
    ulbs: "https://urbangis.mp.gov.in/api/Plantation/GetUlb",
    wards: "https://urbangis.mp.gov.in/api/Plantation/GetWardByULB",
    insert: "https://urbangis.mp.gov.in/api/Seva/InsertSevaEvent"
  };

  const state = {
    lang: localStorage.getItem("ssa-lang") || "hi",
    event: null,
    history: ["home"],
    photos: [],
    locating: false,
    districts: [],
    ulbs: [],
    wards: [],
    ulbAbort: null,
    wardAbort: null,
    successTimer: null
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function t(key) {
    return (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
  }

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDate(iso) {
    const [y, m, day] = iso.split("-").map(Number);
    const months = MONTHS[state.lang] || MONTHS.en;
    return `${day} ${months[m - 1]} ${y}`;
  }

  function setEventDate() {
    const iso = todayISO();
    $("#eventDate").value = iso;
    $("#eventDateDisplay").value = formatDate(iso);
  }

  function applyLanguage() {
    document.documentElement.lang = state.lang;
    document.documentElement.setAttribute("data-lang", state.lang);
    localStorage.setItem("ssa-lang", state.lang);

    $$("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    $$("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    $$(".lang-btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.lang === state.lang));
    });

    fillSelects();
    refillLocationDropdowns();
    if ($("#eventDate").value) {
      $("#eventDateDisplay").value = formatDate($("#eventDate").value);
    }
    if (state.event) setFormCopy(state.event);
    updateCaptureButtonLabel();
    renderPhotos();
    if ($("#latitude").value && $("#longitude").value) {
      updateMap(Number($("#latitude").value), Number($("#longitude").value));
    }
  }

  function placeholderOption(text) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = text;
    return opt;
  }

  function resetSelect(select, placeholder) {
    select.innerHTML = "";
    select.appendChild(placeholderOption(placeholder));
    select.value = "";
  }

  function fillOptions(select, items, getValue, getLabel, placeholder) {
    const current = select.value;
    resetSelect(select, placeholder);
    items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = getValue(item);
      opt.textContent = getLabel(item);
      select.appendChild(opt);
    });
    if (current && [...select.options].some((o) => o.value === current)) {
      select.value = current;
      select.options[0].selected = false;
    }
  }

  function locLabel(en, hi) {
    if (state.lang === "hi") return hi || en || "";
    return en || hi || "";
  }

  function selectedText(select) {
    const opt = select.selectedOptions[0];
    return opt && opt.value ? opt.textContent : "";
  }

  async function postApi(url, body, signal) {
    const headers = { accept: "*/*" };
    const options = { method: "POST", headers, signal };
    if (body) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    if (!res.ok) throw new Error("API " + res.status);
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  }

  function refillLocationDropdowns() {
    const district = $("#district");
    const ulb = $("#ulb");
    const ward = $("#ward");
    if (!district) return;
    if (state.districts.length) {
      fillOptions(district, state.districts, (d) => d.dist_Cd, (d) => locLabel(d.dist_Name, d.dist_Name_Hindi), t("form.selectDistrict"));
      $("#districtName").value = selectedText(district);
    } else if (!district.options.length) {
      resetSelect(district, t("form.selectDistrict"));
    }
    if (state.ulbs.length && district.value) {
      fillOptions(ulb, state.ulbs, (u) => u.ulb_Cd, (u) => locLabel(u.ulB_Name, u.ulB_Name_Hindi), t("form.selectUlb"));
      $("#ulbName").value = selectedText(ulb);
    }
    if (state.wards.length && ulb.value) {
      fillOptions(ward, state.wards, (w) => w.wardNo, (w) => `${w.wardNo} — ${w.wardName}`, t("form.selectWard"));
      $("#wardName").value = selectedText(ward);
    }
  }

  async function loadDistricts() {
    const district = $("#district");
    const ulb = $("#ulb");
    const ward = $("#ward");
    resetSelect(district, t("form.loading"));
    resetSelect(ulb, t("form.selectUlb"));
    resetSelect(ward, t("form.selectWard"));
    district.disabled = true;
    ulb.disabled = true;
    ward.disabled = true;
    $("#districtName").value = "";
    $("#ulbName").value = "";
    $("#wardName").value = "";
    setError("district", "");
    try {
      state.districts = await postApi(API.districts);
      fillOptions(district, state.districts, (d) => d.dist_Cd, (d) => locLabel(d.dist_Name, d.dist_Name_Hindi), t("form.selectDistrict"));
      district.disabled = false;
      if (!state.districts.length) {
        resetSelect(district, t("form.noOptions"));
        district.disabled = true;
      }
    } catch (err) {
      resetSelect(district, t("form.selectDistrict"));
      district.disabled = false;
      setError("district", t("errors.api"));
      showToast(t("errors.api"));
    }
  }

  async function loadUlbs(distCd) {
    const ulb = $("#ulb");
    const ward = $("#ward");
    if (state.ulbAbort) state.ulbAbort.abort();
    if (state.wardAbort) state.wardAbort.abort();
    state.ulbs = [];
    state.wards = [];
    resetSelect(ulb, t("form.loading"));
    resetSelect(ward, t("form.selectWard"));
    ulb.disabled = true;
    ward.disabled = true;
    $("#ulbName").value = "";
    $("#wardName").value = "";
    setError("ulb", "");
    if (!distCd) {
      resetSelect(ulb, t("form.selectUlb"));
      return;
    }
    const controller = new AbortController();
    state.ulbAbort = controller;
    try {
      state.ulbs = await postApi(API.ulbs, { dist_Cd: String(distCd) }, controller.signal);
      if (!state.ulbs.length) {
        resetSelect(ulb, t("form.noOptions"));
        return;
      }
      fillOptions(ulb, state.ulbs, (u) => u.ulb_Cd, (u) => locLabel(u.ulB_Name, u.ulB_Name_Hindi), t("form.selectUlb"));
      ulb.disabled = false;
    } catch (err) {
      if (err.name === "AbortError") return;
      resetSelect(ulb, t("form.selectUlb"));
      setError("ulb", t("errors.api"));
      showToast(t("errors.api"));
    }
  }

  async function loadWards(ulbCode) {
    const ward = $("#ward");
    if (state.wardAbort) state.wardAbort.abort();
    state.wards = [];
    resetSelect(ward, t("form.loading"));
    ward.disabled = true;
    $("#wardName").value = "";
    setError("ward", "");
    if (!ulbCode) {
      resetSelect(ward, t("form.selectWard"));
      return;
    }
    const controller = new AbortController();
    state.wardAbort = controller;
    try {
      state.wards = await postApi(API.wards, { ulbCode: String(ulbCode) }, controller.signal);
      if (!state.wards.length) {
        resetSelect(ward, t("form.noOptions"));
        return;
      }
      fillOptions(ward, state.wards, (w) => w.wardNo, (w) => `${w.wardNo} — ${w.wardName}`, t("form.selectWard"));
      ward.disabled = false;
    } catch (err) {
      if (err.name === "AbortError") return;
      resetSelect(ward, t("form.selectWard"));
      setError("ward", t("errors.api"));
      showToast(t("errors.api"));
    }
  }

  function fillSelects() {
    const saved = {};
    $$(".js-district").forEach((select) => {
      saved[select.id] = select.value;
      select.innerHTML = `<option value="" disabled selected></option>`;
      DISTRICTS.forEach(([en, hi]) => {
        const opt = document.createElement("option");
        opt.value = en;
        opt.textContent = state.lang === "hi" ? `${hi} (${en})` : `${en} (${hi})`;
        select.appendChild(opt);
      });
      if (saved[select.id]) select.value = saved[select.id];
    });

    const gender = $("#gender");
    const blood = $("#bloodGroup");
    const genderVal = gender.value;
    const bloodVal = blood.value;

    gender.innerHTML = `<option value="" disabled selected></option>`;
    [["male", "gender.male"], ["female", "gender.female"], ["other", "gender.other"]].forEach(([value, key]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = t(key);
      gender.appendChild(opt);
    });
    if (genderVal) gender.value = genderVal;

    blood.innerHTML = `<option value="" disabled selected></option>`;
    ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      blood.appendChild(opt);
    });
    if (bloodVal) blood.value = bloodVal;

    ["preferredDate", "lastDonationDate"].forEach((id) => {
      const input = $(`#${id}`);
      if (!input) return;
      if (id !== "lastDonationDate") input.min = todayISO();
      input.max = "2026-12-31";
    });
  }

  function showScreen(name, { push = true } = {}) {
    $$(".screen").forEach((screen) => {
      const active = screen.dataset.screen === name;
      screen.hidden = !active;
      screen.classList.toggle("is-active", active);
    });
    if (push) {
      const last = state.history[state.history.length - 1];
      if (last !== name) state.history.push(name);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    if (state.history.length > 1) state.history.pop();
    const prev = state.history[state.history.length - 1] || "home";
    showScreen(prev, { push: false });
  }

  function setFormCopy(eventType) {
    $("#formTitle").textContent = eventType === "deep" ? t("form.titleDeep") : t("form.titleBlood");
  }

  function setDeepFieldsEnabled(enabled) {
    $$(".field-deep input, .field-deep select, .field-deep textarea").forEach((el) => {
      if (el.id === "ulb" || el.id === "ward") return;
      el.disabled = !enabled;
    });
    $$(".field-blood input, .field-blood select, .field-blood textarea").forEach((el) => {
      el.disabled = enabled;
    });
    if (!enabled) {
      $("#ulb").disabled = true;
      $("#ward").disabled = true;
    } else {
      $("#ulb").disabled = !$("#district").value;
      $("#ward").disabled = !$("#ulb").value;
    }
  }

  function openForm(eventType) {
    state.event = eventType;
    $("#eventType").value = eventType === "deep" ? "deep_prajwalit" : "blood_donation";
    document.body.classList.toggle("is-deep", eventType === "deep");
    document.body.classList.toggle("is-blood", eventType === "blood");
    $$(".event-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.event === eventType);
    });
    setFormCopy(eventType);
    setDeepFieldsEnabled(eventType === "deep");
    if (eventType === "deep") {
      setEventDate();
      captureLocation();
      loadDistricts();
    }
    showScreen("form");
  }

  function mapUrl(lat, lng) {
    const hl = state.lang === "hi" ? "hi" : "en";
    return `https://maps.google.com/maps?q=${lat},${lng}&z=17&hl=${hl}&output=embed`;
  }

  function updateMap(lat, lng) {
    $("#locationMap").src = mapUrl(lat, lng);
    $("#mapOverlay").classList.add("is-hidden");
    $("#coordsBox").hidden = false;
    $("#latValue").textContent = lat.toFixed(6);
    $("#lngValue").textContent = lng.toFixed(6);
    $("#latitude").value = String(lat);
    $("#longitude").value = String(lng);
  }

  function updateCaptureButtonLabel() {
    const btn = $("#captureLocationBtn span");
    if (!btn) return;
    if (state.locating) btn.textContent = t("form.geoLocating");
    else if ($("#latitude").value) btn.textContent = t("form.geoRecapture");
    else btn.textContent = t("form.geoCapture");
  }

  function captureLocation() {
    if (state.locating) return;

    if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      setError("latitude", t("geo.https"));
      showToast(t("geo.https"));
      return;
    }
    if (!navigator.geolocation) {
      setError("latitude", t("geo.unsupported"));
      showToast(t("geo.unsupported"));
      return;
    }

    state.locating = true;
    $("#captureLocationBtn").disabled = true;
    updateCaptureButtonLabel();

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.locating = false;
        $("#captureLocationBtn").disabled = false;
        updateMap(pos.coords.latitude, pos.coords.longitude);
        setError("latitude", "");
        updateCaptureButtonLabel();
      },
      (err) => {
        state.locating = false;
        $("#captureLocationBtn").disabled = false;
        updateCaptureButtonLabel();
        const message = err.code === 1 ? t("geo.denied") : t("geo.unavailable");
        setError("latitude", message);
        showToast(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  }

  function renderPhotos() {
    const grid = $("#photoGrid");
    if (!grid) return;
    grid.innerHTML = "";
    state.photos.forEach((photo) => {
      const item = document.createElement("div");
      item.className = "photo-thumb";
      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = photo.file.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", t("form.photoRemove"));
      remove.textContent = "×";
      remove.addEventListener("click", () => removePhoto(photo.id));
      item.append(img, remove);
      grid.appendChild(item);
    });
    $("#photos").value = String(state.photos.length);
    const camera = $("#photoCamera");
    const full = state.photos.length >= MAX_PHOTOS;
    if (camera) camera.disabled = full;
  }

  function addPhoto(file) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) {
      setError("photos", t("errors.photoType"));
      showToast(t("errors.photoType"));
      return;
    }
    if (state.photos.length >= MAX_PHOTOS) {
      setError("photos", t("errors.photosMax"));
      return;
    }
    state.photos.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      url: URL.createObjectURL(file)
    });
    setError("photos", "");
    renderPhotos();
  }

  function removePhoto(id) {
    const photo = state.photos.find((p) => p.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    state.photos = state.photos.filter((p) => p.id !== id);
    renderPhotos();
  }

  function resetDeepExtras() {
    state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    state.photos = [];
    renderPhotos();
    $("#latitude").value = "";
    $("#longitude").value = "";
    $("#latValue").textContent = "—";
    $("#lngValue").textContent = "—";
    $("#coordsBox").hidden = true;
    $("#mapOverlay").classList.remove("is-hidden");
    $("#locationMap").src = "https://maps.google.com/maps?q=Madhya+Pradesh&z=6&output=embed";
    updateCaptureButtonLabel();
  }

  function setError(id, message) {
    const input = $(`#${id}`);
    const field = input && (input.closest(".field") || input.closest(".form-card") || input.closest(".geo-box"));
    const error = $(`#${id}-error`);
    if (field && field.classList.contains("field")) {
      field.classList.toggle("is-invalid", Boolean(message));
    }
    if (error) error.textContent = message || "";
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function clearErrors() {
    $$(".field-error").forEach((el) => (el.textContent = ""));
    $$(".field.is-invalid").forEach((el) => el.classList.remove("is-invalid"));
  }

  function visible(el) {
    return el && el.offsetParent !== null;
  }

  function positiveInt(value) {
    return /^[1-9]\d*$/.test(String(value).trim());
  }

  function validate() {
    clearErrors();
    let ok = true;

    if (state.event === "deep") {
      if (!$("#district").value) {
        setError("district", t("errors.district"));
        ok = false;
      }
      if (!$("#ulb").value) {
        setError("ulb", t("errors.ulb"));
        ok = false;
      }
      if (!$("#ward").value) {
        setError("ward", t("errors.ward"));
        ok = false;
      }
      if (!$("#eventPlace").value.trim()) {
        setError("eventPlace", t("errors.required"));
        ok = false;
      }
      if (!$("#latitude").value || !$("#longitude").value) {
        setError("latitude", t("errors.location"));
        ok = false;
      }
      if ($("#organizer").value.trim().length < 3) {
        setError("organizer", t("errors.name"));
        ok = false;
      }
      if (!positiveInt($("#diyaCount").value)) {
        setError("diyaCount", t("errors.number"));
        ok = false;
      }
      if (!positiveInt($("#participants").value)) {
        setError("participants", t("errors.number"));
        ok = false;
      }
      if (!$("#remarks").value.trim()) {
        setError("remarks", t("errors.required"));
        ok = false;
      }
      if (state.photos.length < 1) {
        setError("photos", t("errors.photos"));
        ok = false;
      }
    } else {
      const name = $("#fullName").value.trim();
      if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]{1,79}$/u.test(name)) {
        setError("fullName", t("errors.name"));
        ok = false;
      }
      if (!/^[6-9]\d{9}$/.test($("#mobile").value.trim())) {
        setError("mobile", t("errors.mobile"));
        ok = false;
      }
      const email = $("#email").value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError("email", t("errors.email"));
        ok = false;
      }
      if (!$("#bloodDistrict").value) {
        setError("bloodDistrict", t("errors.district"));
        ok = false;
      }
      if (!$("#address").value.trim()) {
        setError("address", t("errors.required"));
        ok = false;
      }
      const age = Number($("#age").value);
      if (!age || age < 18 || age > 65) {
        setError("age", t("errors.age"));
        ok = false;
      }
      if (!$("#gender").value) {
        setError("gender", t("errors.required"));
        ok = false;
      }
      if (!$("#bloodGroup").value) {
        setError("bloodGroup", t("errors.required"));
        ok = false;
      }
      const weight = Number($("#weightKg").value);
      if (!weight || weight < 45) {
        setError("weightKg", t("errors.weight"));
        ok = false;
      }
      if (!$("#preferredDate").value) {
        setError("preferredDate", t("errors.date"));
        ok = false;
      }
    }

    if (!$("#consent").checked) {
      setError("consent", t("errors.consent"));
      ok = false;
    }

    const firstInvalid = $(".is-invalid input, .is-invalid select, .is-invalid textarea, #consent[aria-invalid='true']");
    if (firstInvalid && visible(firstInvalid)) firstInvalid.focus();
    return ok;
  }

  function payloadFromForm(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    data.consent = form.consent.checked;
    data.language = state.lang;
    data.submittedAt = new Date().toISOString();
    if (state.event === "deep") {
      data.photos = state.photos.map((p) => p.file);
      data.photoCount = state.photos.length;
    }
    return data;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function toRawBase64(value) {
    const text = String(value || "");
    return text.includes(",") ? text.split(",")[1] : text;
  }

  function compressPhoto(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(toRawBase64(canvas.toDataURL("image/jpeg", 0.72)));
      };
      img.onerror = async () => {
        URL.revokeObjectURL(url);
        try {
          resolve(toRawBase64(await fileToDataUrl(file)));
        } catch (err) {
          resolve("");
        }
      };
      img.src = url;
    });
  }

  async function photosToBase64() {
    const first = state.photos[0];
    const second = state.photos[1];
    const third = state.photos[2];
    return {
      photoUrl: first ? await compressPhoto(first.file) : "",
      other1: second ? await compressPhoto(second.file) : "",
      other2: third ? await compressPhoto(third.file) : ""
    };
  }

  function buildSevaPayload(photos) {
    return {
      userId: 1,
      programTypeId: 1,
      programTypeName: "दीप प्रज्वलन कार्यक्रम",
      distCd: $("#district").value,
      ulbCd: $("#ulb").value,
      wardId: $("#ward").value,
      programDate: $("#eventDate").value,
      programLocation: $("#eventPlace").value.trim(),
      organizerId: 1,
      totalDiyaCount: Number($("#diyaCount").value) || 0,
      totalParticipantCount: Number($("#participants").value) || 0,
      specialDetails: $("#remarks").value.trim(),
      latitude: Number($("#latitude").value) || 0,
      longitude: Number($("#longitude").value) || 0,
      status: "web_iOS",
      userMobileNo: "1111111111",
      orgName: $("#organizer").value.trim(),
      depName: "NA",
      photoUrl: photos.photoUrl,
      other1: photos.other1,
      other2: photos.other2
    };
  }

  async function insertSevaEvent(payload) {
    const res = await fetch(API.insert, {
      method: "POST",
      headers: {
        accept: "*/*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || t("errors.submit"));
    const code = json.statusCode;
    if (code !== undefined && code !== 200 && code !== "200" && code !== 1 && code !== "1") {
      throw new Error(json.message || t("errors.submit"));
    }
    return json;
  }

  function goToEventSelect() {
    if (state.successTimer) {
      clearTimeout(state.successTimer);
      state.successTimer = null;
    }
    state.history = ["home", "events"];
    document.body.classList.remove("is-deep", "is-blood");
    showScreen("events", { push: false });
  }

  function showThankYou(reference) {
    const refBox = $("#successRef");
    if (reference) {
      refBox.hidden = false;
      $("#registrationId").textContent = reference;
    } else {
      refBox.hidden = true;
      $("#registrationId").textContent = "";
    }
    const svg = $(".success-mark svg");
    if (svg) svg.replaceWith(svg.cloneNode(true));
    showScreen("success");
    state.successTimer = window.setTimeout(goToEventSelect, 2800);
  }

  async function submitRegistration(payload) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const id = "SSA-2026-" + String(Math.floor(100000 + Math.random() * 900000));
    return { ok: true, id, payload };
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    const btn = $("#submitBtn");
    const label = $("#submitBtn span");
    btn.classList.add("is-loading");
    btn.disabled = true;
    if (label) label.textContent = t("form.submitting");

    try {
      if (state.event === "deep") {
        const photos = await photosToBase64();
        if (!photos.photoUrl) throw new Error(t("errors.photos"));
        const result = await insertSevaEvent(buildSevaPayload(photos));
        event.target.reset();
        resetDeepExtras();
        const reference = result.data?.id || result.data?.eventId || result.data || result.message;
        showThankYou(typeof reference === "string" || typeof reference === "number" ? String(reference) : "");
      } else {
        const result = await submitRegistration(payloadFromForm(event.target));
        if (!result.ok) throw new Error("Submit failed");
        event.target.reset();
        showThankYou(result.id);
      }
    } catch (err) {
      showToast(err.message || t("errors.submit"));
    } finally {
      btn.classList.remove("is-loading");
      btn.disabled = false;
      if (label) label.textContent = t("form.submit");
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-on");
    setTimeout(() => toast.classList.remove("is-on"), 3200);
  }

  function leaveSplash() {
    const splash = $("#splash");
    if (!splash.classList.contains("is-active")) return;
    splash.classList.add("is-exiting");
    splash.classList.remove("is-active");
    $("#app").hidden = false;
    $("#ctaContribute")?.focus({ preventScroll: true });
    setTimeout(() => splash.remove(), 560);
  }

  function onPhotoInput(event) {
    addPhoto(event.target.files && event.target.files[0]);
    event.target.value = "";
  }

  function bind() {
    $("#ctaContribute").addEventListener("click", () => showScreen("events"));
    $$(".event-card").forEach((card) => {
      card.addEventListener("click", () => openForm(card.dataset.event));
    });
    $$("[data-back]").forEach((btn) => btn.addEventListener("click", goBack));
    $$(".lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.lang = btn.dataset.lang;
        applyLanguage();
      });
    });
    $("#eventForm").addEventListener("submit", onSubmit);
    $("#successHome").addEventListener("click", goToEventSelect);
    $("#splashSkip").addEventListener("click", leaveSplash);
    $("#mobile").addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
    });
    $("#diyaCount").addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "");
    });
    $("#participants").addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "");
    });
    $("#captureLocationBtn").addEventListener("click", captureLocation);
    $("#photoCamera").addEventListener("change", onPhotoInput);
    $("#district").addEventListener("change", () => {
      $("#districtName").value = selectedText($("#district"));
      loadUlbs($("#district").value);
    });
    $("#ulb").addEventListener("change", () => {
      $("#ulbName").value = selectedText($("#ulb"));
      loadWards($("#ulb").value);
    });
    $("#ward").addEventListener("change", () => {
      $("#wardName").value = selectedText($("#ward"));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyLanguage();
    bind();
    window.setTimeout(leaveSplash, SPLASH_MS);
  });
})();
