/* =============================================
   RENDEZ-VOUS — logique de réservation
   Les créneaux et la réservation passent par le script Google Apps Script
   du compte quentin@plumedefond.fr (dossier ~/plume-de-fond-rdv) :
   il lit l'agenda Google pro + les agendas iCloud publiés.
   ============================================= */
(function () {
  var HOST_TZ = 'Europe/Paris'; // fuseau de l'agenda
  var DURATION = 30;            // minutes
  var DAYS_AHEAD = 42;          // horizon de réservation (le script fait foi)
  var API = 'https://script.google.com/macros/s/AKfycbwfMoLPtZhw1kXOJY0xhHMCHxvwxjo75_sG-w1Y0-yUzWbkKQZiazSJHcHFJKQj6PdSKg/exec';

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

  /* ---------- Script Google ---------- */
  function fetchSlots() {
    return fetch(API + '?action=slots' + (token ? '&token=' + token : ''))
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d.slots || []).map(function (x) { return new Date(x); }); });
  }

  // text/plain : évite la requête préalable CORS, que le script Google ne gère pas
  function post(body) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) { var err = new Error(res.error || 'erreur'); err.code = res.error; throw err; }
      return res;
    });
  }

  function bookSlot(slot, data) {
    return post(Object.assign({}, data, { action: 'book', start: slot.toISOString() }));
  }

  function fetchBooking() {
    return fetch(API + '?action=booking&token=' + token).then(function (r) { return r.json(); });
  }

  /* ---------- État ---------- */
  var slots = [];
  var byDay = {};          // 'YYYY-MM-DD' (fuseau affiché) -> [Date]
  var tz = HOST_TZ;        // fuseau affiché
  var selectedDay = null;
  var selectedSlot = null;
  var viewY, viewM, minYM, maxYM;
  // ?gerer=<jeton> : lien « déplacer ou annuler » de l'invitation
  var token = (new URLSearchParams(location.search).get('gerer') || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(token)) token = '';
  var mode = token ? 'move' : 'book';
  var booking = null;      // { start: Date, end: Date } du rendez-vous géré

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
    if (mode === 'move') {
      $('bk-recap').hidden = !booking || step === 'done';
      if (booking) $('bk-recap-text').textContent = rangeText(booking.start);
    } else {
      $('bk-recap').hidden = (step === 'pick' || step === 'manage');
    }
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

  function rangeText(start) {
    var end = new Date(start.getTime() + DURATION * 60000);
    return cap(fmtDayLong.format(keyToUTC(dayKey(start, tz)))) + ', ' + fmtTime(start, tz) + ' – ' + fmtTime(end, tz);
  }

  function recapText() { return rangeText(selectedSlot); }

  function pickSlot(s) {
    selectedSlot = s;
    if (mode === 'move') {
      $('mv-when').textContent = rangeText(s);
      $('mv-old').textContent = 'Au lieu du ' + rangeText(booking.start).replace(/^./, function (c) { return c.toLowerCase(); }) + '.';
      $('mv-status').textContent = '';
      show('move');
      return;
    }
    $('bk-recap-text').textContent = recapText();
    show('form');
    $('f-nom').focus({ preventScroll: true });
  }

  function done(title, text, link) {
    $('done-title').textContent = title;
    var t = $('done-text');
    t.textContent = '';
    t.append.apply(t, text);
    var a = $('done-link');
    a.hidden = !link;
    if (link) { a.href = link.href; a.textContent = link.label; }
    show('done');
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
    bookSlot(selectedSlot, data).then(function (res) {
      var strong = document.createElement('strong');
      strong.textContent = data.email;
      done('C’est noté.', [recapText() + '. L’invitation Google Meet arrive à ', strong, '.'],
        res.token ? { href: '?gerer=' + res.token, label: 'Déplacer ou annuler ce rendez-vous' } : null);
    }).catch(function (err) {
      if (err.code === 'creneau pris') {
        status.textContent = 'Ce créneau vient d’être pris, choisissez-en un autre.';
        loadSlots(); // on rafraîchit les disponibilités
      } else {
        status.textContent = 'La réservation n’a pas abouti. Réessayez, ou écrivez-nous à contact@plumedefond.fr';
      }
      status.classList.add('err');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = 'Confirmer';
    });
  });

  /* ---------- Gérer un rendez-vous ---------- */
  function manageMessage(kicker, when, sub) {
    $('mg-kicker').textContent = kicker;
    $('mg-when').textContent = when;
    $('mg-sub').textContent = sub;
    $('mg-actions').hidden = true;
    $('mg-confirm').hidden = true;
    $('mg-new').hidden = false;
  }

  function loadBooking() {
    show('manage');
    fetchBooking().then(function (b) {
      if (!b.ok) return manageMessage('Lien invalide', 'Ce rendez-vous est introuvable.', 'Le lien a peut-être expiré. Vous pouvez réserver un nouveau créneau.');
      if (b.status === 'cancelled') return manageMessage('Rendez-vous annulé', 'Ce rendez-vous a été annulé.', 'Vous pouvez réserver un nouveau créneau quand vous le souhaitez.');
      booking = { start: new Date(b.start), end: new Date(b.end) };
      if (b.status === 'past') return manageMessage('Rendez-vous passé', rangeText(booking.start), 'Ce rendez-vous a déjà eu lieu. Vous pouvez en réserver un nouveau.');
      $('mg-when').textContent = rangeText(booking.start);
      $('mg-sub').textContent = 'Visio Google Meet' + (b.nom ? ' - ' + b.nom + (b.societe ? ', ' + b.societe : '') : '') + '. Le lien de la visio figure dans votre invitation.';
      $('mg-actions').hidden = false;
      show('manage');
    }).catch(function () {
      manageMessage('Erreur', 'Le rendez-vous n’a pas pu être chargé.', 'Rechargez la page, ou écrivez-nous à contact@plumedefond.fr.');
    });
  }

  function newBooking() {
    mode = 'book';
    token = '';
    booking = null;
    history.replaceState(null, '', location.pathname);
    show('pick');
    loadSlots();
  }

  function busy(btn, label) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = label; }
  function idle(btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }

  $('mg-move').addEventListener('click', function () { show('pick'); });
  $('mg-cancel').addEventListener('click', function () { $('mg-actions').hidden = true; $('mg-confirm').hidden = false; });
  $('mg-keep').addEventListener('click', function () { $('mg-confirm').hidden = true; $('mg-actions').hidden = false; });
  $('mg-book').addEventListener('click', newBooking);
  $('mv-back').addEventListener('click', function () { show('pick'); });

  $('mg-cancel-ok').addEventListener('click', function () {
    var btn = this, status = $('mg-status');
    busy(btn, 'Annulation…');
    status.textContent = '';
    post({ action: 'cancel', token: token }).then(function () {
      done('Rendez-vous annulé.', ['Le créneau du ' + rangeText(booking.start).replace(/^./, function (c) { return c.toLowerCase(); }) + ' est libéré. Au plaisir d’échanger une prochaine fois.'],
        { href: location.pathname, label: 'Réserver un autre créneau' });
    }).catch(function () {
      status.textContent = 'L’annulation n’a pas abouti. Réessayez, ou écrivez-nous à contact@plumedefond.fr';
      status.classList.add('err');
    }).finally(function () { idle(btn); });
  });

  $('mv-ok').addEventListener('click', function () {
    var btn = this, status = $('mv-status');
    busy(btn, 'Déplacement…');
    status.textContent = '';
    status.classList.remove('err');
    post({ action: 'move', token: token, start: selectedSlot.toISOString() }).then(function () {
      booking = { start: selectedSlot, end: new Date(selectedSlot.getTime() + DURATION * 60000) };
      done('Rendez-vous déplacé.', [rangeText(selectedSlot) + '. L’invitation mise à jour arrive dans votre boîte mail ; le lien de la visio ne change pas.'],
        { href: '?gerer=' + token, label: 'Déplacer ou annuler ce rendez-vous' });
      loadSlots();
    }).catch(function (err) {
      status.textContent = err.code === 'creneau pris'
        ? 'Ce créneau vient d’être pris, choisissez-en un autre.'
        : 'Le déplacement n’a pas abouti. Réessayez, ou écrivez-nous à contact@plumedefond.fr';
      status.classList.add('err');
      if (err.code === 'creneau pris') loadSlots();
    }).finally(function () { idle(btn); });
  });

  /* ---------- Démarrage ---------- */
  var t0 = keyToUTC(dayKey(new Date(), tz));
  viewY = t0.getUTCFullYear(); viewM = t0.getUTCMonth();
  minYM = ym(viewY, viewM);
  var tMax = new Date(t0.getTime() + (DAYS_AHEAD + 1) * 86400000);
  maxYM = ym(tMax.getUTCFullYear(), tMax.getUTCMonth());
  renderMonth();
  elSlotsDay.textContent = 'Chargement…';

  function loadSlots() {
    return fetchSlots().then(function (list) {
      slots = list;
      groupSlots();
      // ?jour=AAAA-MM-JJ : jour présélectionné depuis l'encart de l'accueil
      var asked = selectedDay || new URLSearchParams(location.search).get('jour');
      selectDay(byDay[asked] ? asked : Object.keys(byDay).sort()[0]);
    }).catch(function () {
      elSlotsDay.textContent = '';
      elSlots.innerHTML = '<p class="slots-empty">Les disponibilités n’ont pas pu être chargées. Rechargez la page, ou écrivez-nous à <a href="mailto:contact@plumedefond.fr">contact@plumedefond.fr</a>.</p>';
    });
  }
  if (token) loadBooking();
  loadSlots();
})();
