/* =============================================
   RENDEZ-VOUS — logique de réservation (prototype 2026-10-17)
   Les créneaux viennent de fetchSlots() / bookSlot() : pour l'instant
   une maquette locale, à remplacer par l'appel au script Google.
   ============================================= */
(function () {
  var HOST_TZ = 'Europe/Paris'; // fuseau de l'agenda
  var DURATION = 30;            // minutes
  var DAYS_AHEAD = 42;          // horizon de réservation
  var MIN_NOTICE_H = 24;        // délai minimum avant un créneau

  var ZONES = [
    ['Europe/Paris', 'Paris'],
    ['America/Martinique', 'Martinique'],
    ['America/Guadeloupe', 'Guadeloupe'],
    ['America/Cayenne', 'Guyane'],
    ['Indian/Reunion', 'La Réunion'],
    ['Europe/London', 'Londres'],
    ['America/Montreal', 'Montréal'],
    ['America/New_York', 'New York']
  ];

  /* ---------- Fuseaux ---------- */
  function tzOffsetMin(date, tz) {
    var o = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    var asUTC = Date.UTC(+o.year, o.month - 1, +o.day, o.hour % 24, +o.minute, +o.second);
    return (asUTC - date.getTime()) / 60000;
  }

  function wallTime(tz, y, m, d, h, mi) {
    var guess = Date.UTC(y, m, d, h, mi);
    return new Date(guess - tzOffsetMin(new Date(guess), tz) * 60000);
  }

  function dayKey(date, tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
  }

  function keyToUTC(key) {
    var p = key.split('-');
    return new Date(Date.UTC(+p[0], p[1] - 1, +p[2]));
  }

  function fmtTime(date, tz) {
    var o = {};
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return (+o.hour) + ' h ' + o.minute;
  }

  var fmtDayLong = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  var fmtWeekday = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short' });
  var fmtDayMonth = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  var fmtMonth = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long' });

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- Source des créneaux (maquette) ---------- */
  // Plages fictives, heure de Paris : mardi et jeudi 14 h–18 h, mercredi 10 h–12 h.
  var PLAGES = { 2: [[14, 18]], 3: [[10, 12]], 4: [[14, 18]] };

  function fetchSlots() {
    var now = Date.now();
    var today = keyToUTC(dayKey(new Date(), HOST_TZ));
    var slots = [];
    for (var i = 0; i <= DAYS_AHEAD; i++) {
      var d = new Date(today.getTime() + i * 86400000);
      (PLAGES[d.getUTCDay()] || []).forEach(function (r) {
        for (var min = r[0] * 60; min + DURATION <= r[1] * 60; min += DURATION) {
          var start = wallTime(HOST_TZ, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(min / 60), min % 60);
          if (start.getTime() - now < MIN_NOTICE_H * 3600000) continue;
          if ((d.getUTCDate() * 7 + min / 30) % 3 === 0) continue; // agenda fictif : un créneau sur trois pris
          slots.push(start);
        }
      });
    }
    return new Promise(function (resolve) { setTimeout(function () { resolve(slots); }, 250); });
  }

  function bookSlot(slot, data) {
    return new Promise(function (resolve) { setTimeout(resolve, 700); });
  }

  /* ---------- État ---------- */
  var slots = [];
  var byDay = {};          // 'YYYY-MM-DD' (fuseau affiché) -> [Date]
  var tz = HOST_TZ;        // fuseau affiché
  var selectedDay = null;
  var selectedSlot = null;
  var viewY, viewM, minYM, maxYM;

  var $ = function (id) { return document.getElementById(id); };
  var card = $('booking-card');
  var elDays = $('cal-days'), elMonth = $('cal-month'), elPrev = $('cal-prev'), elNext = $('cal-next');
  var elSlotsDay = $('slots-day'), elSlots = $('slots-list'), elTz = $('bk-tz');

  // cercle manuscrit de la première version, écrasé en ovale autour du chiffre
  var CIRCLE = '<svg class="day-circle" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" aria-hidden="true">' +
    '<path d="M 60 7 C 84 9, 95 29, 93 52 C 91 77, 71 93, 47 92 C 23 91, 6 73, 7 48 C 8 24, 28 6, 54 7 C 75 8, 90 20, 93 37" ' +
    'stroke="#1b1916" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';

  function show(step) {
    card.dataset.step = step;
    $('bk-recap').hidden = (step === 'pick');
  }

  function ym(y, m) { return y * 12 + m; }

  /* ---------- Fuseau ---------- */
  var localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (localTZ && !ZONES.some(function (z) { return z[0] === localTZ; })) {
    ZONES.push([localTZ, localTZ.split('/').pop().replace(/_/g, ' ')]);
  }
  ZONES.forEach(function (z) {
    var o = document.createElement('option');
    o.value = z[0];
    o.textContent = 'Heure de ' + z[1];
    elTz.appendChild(o);
  });
  tz = localTZ && ZONES.some(function (z) { return z[0] === localTZ; }) ? localTZ : HOST_TZ;
  elTz.value = tz;
  elTz.addEventListener('change', function () {
    tz = elTz.value;
    groupSlots();
    var days = Object.keys(byDay).sort();
    selectDay(byDay[selectedDay] ? selectedDay : days[0]);
  });

  function groupSlots() {
    byDay = {};
    slots.forEach(function (s) { var k = dayKey(s, tz); (byDay[k] = byDay[k] || []).push(s); });
  }

  /* ---------- Calendrier ---------- */
  function renderMonth() {
    var first = new Date(Date.UTC(viewY, viewM, 1));
    elMonth.innerHTML = cap(fmtMonth.format(first)) + ' <span>' + viewY + '</span>';
    elPrev.disabled = ym(viewY, viewM) <= minYM;
    elNext.disabled = ym(viewY, viewM) >= maxYM;

    var todayKey = dayKey(new Date(), tz);
    var lead = (first.getUTCDay() + 6) % 7; // lundi en premier
    var nDays = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    var html = '';
    for (var i = 0; i < lead; i++) html += '<span></span>';
    for (var d = 1; d <= nDays; d++) {
      var key = viewY + '-' + String(viewM + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var open = !!byDay[key];
      var cls = 'cal-day' + (open ? ' is-open' : '') + (key === selectedDay ? ' is-selected' : '') + (key === todayKey ? ' is-today' : '');
      html += '<button type="button" class="' + cls + '" data-day="' + key + '"' + (open ? '' : ' disabled') +
        ' aria-label="' + fmtDayLong.format(keyToUTC(key)) + (open ? ', créneaux disponibles' : '') + '"' +
        (key === selectedDay ? ' aria-pressed="true"' : '') + '>' + d + (open ? CIRCLE : '') + '</button>';
    }
    elDays.innerHTML = html;
  }

  function selectDay(key) {
    elSlots.innerHTML = '';
    if (!key) {
      selectedDay = null;
      elSlotsDay.textContent = '';
      elSlots.innerHTML = '<p class="slots-empty">Aucun créneau libre pour le moment. Écrivez-nous, nous trouverons un moment.</p>';
      renderMonth();
      return;
    }
    selectedDay = key;
    var day = keyToUTC(key);
    viewY = day.getUTCFullYear(); viewM = day.getUTCMonth();
    renderMonth();
    elSlotsDay.innerHTML = cap(fmtWeekday.format(day)) + ' <span>' + fmtDayMonth.format(day) + '</span>';
    byDay[key].forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.textContent = fmtTime(s, tz);
      b.addEventListener('click', function () { pickSlot(s); });
      elSlots.appendChild(b);
    });
  }

  function recapText() {
    var end = new Date(selectedSlot.getTime() + DURATION * 60000);
    return cap(fmtDayLong.format(keyToUTC(selectedDay))) + ', ' + fmtTime(selectedSlot, tz) + ' – ' + fmtTime(end, tz);
  }

  function pickSlot(s) {
    selectedSlot = s;
    $('bk-recap-text').textContent = recapText();
    show('form');
    $('f-nom').focus({ preventScroll: true });
  }

  elDays.addEventListener('click', function (e) {
    var b = e.target.closest('.cal-day.is-open');
    if (b) selectDay(b.dataset.day);
  });
  elPrev.addEventListener('click', function () { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderMonth(); });
  elNext.addEventListener('click', function () { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderMonth(); });
  $('back-to-pick').addEventListener('click', function () { show('pick'); });

  /* ---------- Formulaire ---------- */
  $('booking-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, status = $('booking-status'), btn = $('booking-submit');
    status.classList.remove('ok', 'err');
    if (!form.checkValidity()) {
      status.textContent = 'Merci de compléter les champs requis (email valide).';
      status.classList.add('err');
      return;
    }
    var data = Object.fromEntries(new FormData(form));
    if (data._gotcha) return;
    btn.disabled = true;
    btn.textContent = 'Réservation…';
    status.textContent = '';
    bookSlot(selectedSlot, data).then(function () {
      var t = $('done-text');
      t.textContent = '';
      var strong = document.createElement('strong');
      strong.textContent = data.email;
      t.append(recapText() + '. L’invitation Google Meet arrive à ', strong, '.');
      show('done');
    }).catch(function () {
      status.textContent = 'Ce créneau vient d’être pris — choisissez-en un autre.';
      status.classList.add('err');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = 'Confirmer';
    });
  });

  /* ---------- Démarrage ---------- */
  var t0 = keyToUTC(dayKey(new Date(), tz));
  viewY = t0.getUTCFullYear(); viewM = t0.getUTCMonth();
  minYM = ym(viewY, viewM);
  var tMax = new Date(t0.getTime() + (DAYS_AHEAD + 1) * 86400000);
  maxYM = ym(tMax.getUTCFullYear(), tMax.getUTCMonth());
  renderMonth();
  elSlotsDay.textContent = 'Chargement…';

  fetchSlots().then(function (list) {
    slots = list;
    groupSlots();
    // ?jour=AAAA-MM-JJ : jour présélectionné depuis l'encart de l'accueil
    var asked = new URLSearchParams(location.search).get('jour');
    selectDay(byDay[asked] ? asked : Object.keys(byDay).sort()[0]);
  });
})();
