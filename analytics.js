/* =============================================
   MESURE D'AUDIENCE — PostHog (cloud UE, Francfort) + bandeau de consentement
   - Sans accord (pas encore répondu, ou refus) : comptage SANS cookie
     (cookieless_mode « always », empreinte calculée par PostHog, rien n'est
     stocké chez le visiteur) : pages, sources, parcours, étapes, clics.
   - Avec accord (« Accepter ») : suivi complet à partir de la page suivante
     (visites successives, pays, enregistrements aux champs masqués,
     identification à la réservation).
   - PostHog ne sait pas passer d'un mode à l'autre dans une page ouverte
     (testé le 2026-10-17) : le mode est choisi au chargement, d'après le choix
     enregistré. Exception : à la réservation, une instance complète est créée
     pour identifier la personne si elle vient d'accepter sur la même page.
   - Choix gardé 6 mois puis redemandé ; lien « Gérer les cookies » en pied de page.
   Événements métier : window.pdfTrack(nom, props) ; identification : window.pdfIdentify(email, props).
   ============================================= */
(function () {
  var KEY = 'phc_qzcUmKhd4fMF44Uf2DNaXDuABNUsJRPSc2cT3DhwKeuE';
  var HOST = 'https://eu.i.posthog.com';
  var REASK_DAYS = 182;
  var CHOICE = 'pdf_consent';     // 'yes' | 'no' : choix du visiteur (stockage strictement nécessaire)
  var STAMP = 'pdf_consent_at';

  /* chargeur officiel PostHog */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  function store(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // efface ce que PostHog a pu stocker (refus, ou accord expiré)
  function wipe() {
    try {
      Object.keys(localStorage).forEach(function (k) { if (/^(ph_|__ph)/.test(k)) localStorage.removeItem(k); });
      document.cookie.split(';').forEach(function (c) {
        var n = c.split('=')[0].trim();
        if (/^(ph_|__ph)/.test(n)) {
          document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
          document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + location.hostname.replace(/^www\./, '');
        }
      });
    } catch (e) {}
  }

  var choice = read(CHOICE);
  var fresh = Date.now() - Number(read(STAMP) || 0) < REASK_DAYS * 86400000;
  if (!fresh && choice) { store(CHOICE, null); store(STAMP, null); choice = null; }
  var full = choice === 'yes';
  if (!full) wipe();

  var base = {
    api_host: HOST,
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    capture_heatmaps: true,
    session_recording: { maskAllInputs: true },
    // sans accord, le paramètre ?de=… (lien personnel d'un prospect) ne quitte pas le navigateur
    before_send: function (ev) {
      try {
        if (!full && ev && ev.properties) {
          ['$current_url', '$referrer', '$initial_current_url'].forEach(function (k) {
            var v = ev.properties[k];
            if (typeof v === 'string' && v.indexOf('de=') !== -1) {
              var u = new URL(v); u.searchParams.delete('de'); ev.properties[k] = u.toString();
            }
          });
        }
      } catch (e) {}
      return ev;
    }
  };

  function cfg(withCookies) {
    var c = {};
    for (var k in base) c[k] = base[k];
    if (!withCookies) { c.cookieless_mode = 'always'; c.disable_session_recording = true; }
    return c;
  }

  posthog.init(KEY, cfg(full));
  if (full) tagProspect();

  /* ?de=maison-x : liens personnalisés envoyés aux prospects (suivi complet seulement) */
  function tagProspect() {
    var de = new URLSearchParams(location.search).get('de');
    if (!de) return;
    de = de.slice(0, 80);
    posthog.register({ prospect: de });
    posthog.setPersonProperties({ prospect: de });
  }

  /* événements métier, appelés par les pages (ex. réservation) */
  window.pdfTrack = function (event, props) {
    try { posthog.capture(event, props || {}); } catch (e) {}
  };

  // rattache la navigation à une personne : seulement si elle a accepté
  window.pdfIdentify = function (email, props) {
    try {
      if (read(CHOICE) !== 'yes') return;
      if (full) { posthog.identify(email, props || {}); return; }
      // accord donné sur cette même page : instance complète créée à la volée
      var ph = posthog.init(KEY, cfg(true), 'pdf_full');
      ph.identify(email, props || {});
    } catch (e) {}
  };

  /* ---------- bandeau ---------- */
  var banner;
  function decide(accept) {
    store(CHOICE, accept ? 'yes' : 'no');
    store(STAMP, String(Date.now()));
    // PostHog réécrit son stockage juste après l'opt-out : on nettoie aussi un peu plus tard
    if (!accept && full) { posthog.opt_out_capturing(); wipe(); setTimeout(wipe, 1500); full = false; }
    if (banner) { banner.classList.remove('is-open'); setTimeout(function () { banner.hidden = true; }, 300); }
  }

  function showBanner() {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'cookie-banner';
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-label', 'Choix des cookies');
      banner.innerHTML =
        '<p class="cookie-kicker">Cookies</p>' +
        '<p class="cookie-text">Nous utilisons des cookies pour améliorer le site. <a href="confidentialite.html#cookies">En savoir plus</a></p>' +
        '<div class="cookie-actions">' +
          '<button type="button" class="cookie-btn" data-choice="no">Refuser</button>' +
          '<button type="button" class="cookie-btn" data-choice="yes">Accepter</button>' +
        '</div>';
      banner.addEventListener('click', function (e) {
        var b = e.target.closest('[data-choice]');
        if (b) decide(b.dataset.choice === 'yes');
      });
      document.body.appendChild(banner);
    }
    banner.hidden = false;
    requestAnimationFrame(function () { banner.classList.add('is-open'); });
  }

  function ready(fn) { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn(); }
  if (!choice) ready(showBanner);

  // lien « Gérer les cookies » du pied de page
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.cookie-manage')) return;
    e.preventDefault();
    showBanner();
  });
})();
