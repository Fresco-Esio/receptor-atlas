/* ============================================================================
   Atlas bridge — how a volume talks to the shell.

   The three volumes speak one protocol but are internally unalike: each has its
   own id scheme (the Archive numbers entries, the Cabinet uses target aliases,
   the Ledger uses row numbers) and its own way of moving to a subject. So this
   is a factory, not a shared singleton: it owns the transport and the message
   envelopes, and each page supplies the two things only it knows.

   Messages, all via postMessage to the parent frame:
     up   atlas:ready    { volume }                  volume has booted
     up   atlas:subject  { volume, subject, label }  the open subject changed
     down atlas:nav      { subject, station }        shell asks us to go somewhere

   `subject` is always a CANONICAL id ('5ht2a', 'd2', 'mu'), never a local one.
   ============================================================================ */

(function (global) {
  'use strict';

  function isFramed() {
    try { return global.self !== global.top; } catch (e) { return true; }
  }

  /**
   * Wire a volume into the shell.
   *
   * @param {object}   cfg
   * @param {string}   cfg.volume          'archive' | 'cabinet' | 'ledger'
   * @param {function} cfg.currentSubject  () => canonical id or null, right now
   * @param {function} cfg.applyNav        (canonicalSubject, station) => void
   * @param {number}   [cfg.startDelay]    ms to wait before first emit (default 130)
   * @returns {{emit: function}|null}      null when running standalone
   */
  global.createAtlasBridge = function createAtlasBridge(cfg) {
    // Standalone (not in the shell, no ?embed): the bridge is inert.
    if (!isFramed() && location.search.indexOf('embed') === -1) return null;

    var startDelay = cfg.startDelay == null ? 130 : cfg.startDelay;

    function up(msg) { try { parent.postMessage(msg, '*'); } catch (e) {} }

    // Called with no argument, the bridge asks the page what is open now.
    // Called with a value, the page is telling it directly.
    function emit(subject) {
      var canon = subject === undefined ? cfg.currentSubject() : subject;
      up({ type: 'atlas:subject', volume: cfg.volume, subject: canon || null, label: '' });
    }

    global.addEventListener('hashchange', function () { emit(); });
    global.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.type !== 'atlas:nav') return;
      cfg.applyNav(d.subject, d.station);
    });

    function start() {
      var params;
      try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
      if (params) cfg.applyNav(params.get('subject'), params.get('station'));
      up({ type: 'atlas:ready', volume: cfg.volume });
      emit();
    }

    if (document.readyState === 'loading')
      global.addEventListener('DOMContentLoaded', function () { setTimeout(start, startDelay); });
    else setTimeout(start, startDelay);

    return { emit: emit };
  };

  /** Announce a cross-volume trace to the shell. Used by in-page "trace" links. */
  global.atlasTrace = function atlasTrace(toVolume, canonicalSubject) {
    if (!isFramed()) return;
    try {
      parent.postMessage({ type: 'atlas:trace', to: toVolume, subject: canonicalSubject }, '*');
    } catch (e) {}
  };
})(window);
