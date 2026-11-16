/*
 * Cliente: vistas y eventos de Socket.io.
 * La misma página sirve para los participantes ("/") y para el panel ("/admin").
 */
(function () {
  'use strict';

  var IS_ADMIN = /^\/admin\/?$/.test(location.pathname);
  var socket = io({ reconnectionDelayMax: 3000 });

  // ------------------------------------------------------------------ utilidades
  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function show(view) {
    if (document.body.dataset.view === view) return;
    document.body.dataset.view = view;
    window.scrollTo(0, 0);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // 0.312 → "31,2 %"; null → "—"
  function pct(x, digits) {
    if (x == null) return '—';
    return (x * 100).toFixed(digits == null ? 0 : digits).replace('.', ',') + ' %';
  }

  function predLabel(v) { return v ? 'Abandona' : 'No abandona'; }

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) {
      try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* modo privado */ }
    }
  };

  var toastTimer = null;
  function toast(message, ms) {
    var t = $('toast');
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 3000);
  }

  function setQuestion(q) {
    all('[data-question]').forEach(function (n) { n.textContent = q; });
  }
  function setRate(r) {
    all('[data-rate]').forEach(function (n) { n.textContent = pct(r, 1); });
  }

  // ================================================================== PARTICIPANTE
  function initPlayer() {
    var me = { id: store.get('vote_player_id') };
    var answer = null;
    var changing = false;
    var sending = false;

    function join() {
      socket.emit('join', { playerId: me.id }, function (res) {
        if (!res || !res.ok) {
          show('vote');
          $('vote-error').textContent = (res && res.error) || 'No se pudo entrar. Recargá la página.';
          return;
        }
        me.id = res.playerId;
        store.set('vote_player_id', me.id);
        setQuestion(res.question);
        answer = res.answer;
        if (res.phase === 'results') return showResult(res.results, res.mine);
        if (answer && !changing) return showWait();
        show('vote');
      });
    }

    function send(value) {
      if (sending) return;
      sending = true;
      $('vote-error').textContent = '';
      socket.emit('answer', { playerId: me.id, value: value }, function (res) {
        sending = false;
        if (!res || !res.ok) {
          $('vote-error').textContent = (res && res.error) || 'No se pudo enviar. Probá de nuevo.';
          return;
        }
        answer = res.answer;
        changing = false;
        showWait();
      });
    }

    function showWait() {
      $('wait-answer').textContent = answer === 'si' ? 'Sí' : 'No';
      show('wait');
    }

    function showResult(results, mine) {
      if (!results) return;
      var has = !!mine;
      $('me-none').hidden = has;
      all('.me-models, .me-answer').forEach(function (n) { n.hidden = !has; });
      if (has) {
        var real = mine.answer === 'si';
        $('me-answer').textContent = real ? 'Respondiste que sí abandonaste' : 'Respondiste que no abandonaste';
        $('me-random').textContent = predLabel(mine.predRandom);
        $('me-dummy').textContent = predLabel(mine.predDummy);
        setOk($('me-random-ok'), mine.predRandom === real);
        setOk($('me-dummy-ok'), mine.predDummy === real);
        $('me-always').textContent = predLabel(mine.predAlways);
        setOk($('me-always-ok'), mine.predAlways === real);
      }
      var c = results.counts;
      $('mini-counts').textContent = c.yes + ' abandonaron · ' + c.no + ' no abandonaron';
      $('mini-recall').textContent = c.yes
        ? 'El azar detectó a ' + results.random.tp + ' de ' + c.yes + '. “Siempre abandona” detectó a todos; “siempre no abandona”, a ninguno.'
        : 'Nadie abandonó: no había a quién detectar.';
      show('result');
    }

    function setOk(node, ok) {
      node.textContent = ok ? '✓ Acertó' : '✗ Se equivocó';
      node.className = 'me-model__ok ' + (ok ? 'is-ok' : 'is-bad');
    }

    all('[data-answer]').forEach(function (b) {
      b.addEventListener('click', function () { send(b.dataset.answer); });
    });
    $('btn-change').addEventListener('click', function () {
      changing = true;
      show('vote');
    });

    socket.on('connect', join);
    socket.on('disconnect', function () { toast('Se perdió la conexión. Reconectando…', 4000); });
    socket.on('results', function (d) { changing = false; showResult(d.results, d.mine); });
    socket.on('reset', function () {
      answer = null;
      changing = false;
      $('vote-error').textContent = '';
      show('vote');
    });
  }

  // ================================================================== PANEL
  function initAdmin() {
    show('admin');
    document.title = 'Panel · Juego OULAD';
    var params = new URLSearchParams(location.search);
    var key = params.get('key') || store.get('vote_admin_key') || '';

    function hello() {
      socket.emit('admin_hello', { key: key, origin: location.origin }, function (res) {
        if (!res || !res.ok) {
          $('admin-auth').hidden = false;
          $('admin-auth-error').textContent = key ? ((res && res.error) || 'Clave incorrecta.') : '';
          $('admin-key').focus();
          return;
        }
        $('admin-auth').hidden = true;
        store.set('vote_admin_key', key);
        // Saca la clave de la barra de direcciones (el panel se proyecta).
        if (params.has('key')) history.replaceState(null, '', '/admin');
        $('join-url').href = res.joinUrl;
        $('join-url').textContent = res.joinUrl.replace(/^https?:\/\//, '');
        $('join-qr').innerHTML = res.qrSvg || '';
      });
    }

    function render(s) {
      $('view-admin').dataset.phase = s.phase;
      setQuestion(s.question);
      setRate(s.baseRate);
      var c = s.counts;
      $('live-answered').textContent = c.answered;
      $('live-joined').textContent = !c.pending
        ? ''
        : c.pending + (c.pending === 1 ? ' persona está respondiendo…' : ' personas están respondiendo…');
      $('btn-close').disabled = c.answered === 0;
      if (s.phase === 'results' && s.results) renderResults(s.results, s.detail);
    }

    function renderResults(r, detail) {
      var c = r.counts;
      $('tot-yes').textContent = c.yes;
      $('tot-no').textContent = c.no;
      $('tot-rate').textContent = pct(c.answered ? c.yes / c.answered : null);
      $('draw-label').textContent = r.draw > 1 ? ' · tirada ' + r.draw : '';
      renderMatrix($('cm-random'), r.random);
      renderMatrix($('cm-dummy'), r.dummy);
      renderMetrics($('mt-random'), r.random, c);
      renderMetrics($('mt-dummy'), r.dummy, c);
      renderMatrix($('cm-always'), r.always);
      renderMetrics($('mt-always'), r.always, c);
      renderDetail(detail);
    }

    // Filas: lo real. Columnas: lo predicho (como la matriz de la diapositiva 18).
    function renderMatrix(node, m) {
      node.textContent = '';
      var grid = el('div', 'cm__grid');
      grid.appendChild(el('span', 'cm__corner'));
      grid.appendChild(el('span', 'cm__col', 'Predijo: no abandona'));
      grid.appendChild(el('span', 'cm__col', 'Predijo: abandona'));
      grid.appendChild(el('span', 'cm__row', 'Real: no abandonó'));
      grid.appendChild(cell(m.tn, 'Verdaderos negativos', 'ok'));
      grid.appendChild(cell(m.fp, 'Falsas alarmas', 'warn'));
      grid.appendChild(el('span', 'cm__row', 'Real: abandonó'));
      grid.appendChild(cell(m.fn, 'No detectados', 'bad'));
      grid.appendChild(cell(m.tp, 'Detectados', 'hit'));
      node.appendChild(grid);
    }

    function cell(n, label, kind) {
      var c = el('div', 'cm__cell cm__cell--' + kind + (n ? '' : ' is-zero'));
      c.appendChild(el('span', 'cm__n', String(n)));
      c.appendChild(el('span', 'cm__label', label));
      return c;
    }

    function renderMetrics(node, m, c) {
      node.textContent = '';
      add('Accuracy', pct(m.accuracy), 'aciertos sobre el total');
      add('Recall', pct(m.recall), m.recall == null ? 'nadie abandonó' : 'de los que abandonaron, cuántos detectó');
      add('Precision', pct(m.precision), m.precision == null ? 'no alertó a nadie' : 'de los alertados, cuántos abandonaron');
      function add(name, value, help) {
        var d = el('div', 'metric');
        d.appendChild(el('dt', null, name));
        d.appendChild(el('dd', 'metric__v', value));
        d.appendChild(el('dd', 'metric__h', help));
        node.appendChild(d);
      }
    }

    function renderDetail(rows) {
      var tbody = $('detail-body');
      tbody.textContent = '';
      rows.forEach(function (p) {
        var real = p.answer === 'si';
        var tr = el('tr');
        tr.appendChild(el('td', null, '#' + p.number));
        tr.appendChild(el('td', null, real ? 'Sí, abandonó' : 'No'));
        tr.appendChild(pred(p.predRandom, real));
        tr.appendChild(pred(p.predDummy, real));
        tr.appendChild(pred(p.predAlways, real));
        tbody.appendChild(tr);
      });
      function pred(v, real) {
        if (v == null) return el('td', null, '—');
        return el('td', v === real ? 'is-ok' : 'is-bad', predLabel(v) + (v === real ? ' ✓' : ' ✗'));
      }
    }

    $('admin-auth').addEventListener('submit', function (e) {
      e.preventDefault();
      key = $('admin-key').value.trim();
      hello();
    });
    $('btn-close').addEventListener('click', function () {
      socket.emit('close_and_predict', {}, function (res) {
        if (res && !res.ok && res.error) toast(res.error);
      });
    });
    $('btn-reroll').addEventListener('click', function () { socket.emit('reroll'); });
    $('btn-detail').addEventListener('click', function () {
      var t = $('detail');
      t.hidden = !t.hidden;
      this.setAttribute('aria-expanded', String(!t.hidden));
      this.textContent = t.hidden ? 'Ver detalle anónimo' : 'Ocultar detalle';
    });
    $('btn-reset').addEventListener('click', function () {
      if (confirm('¿Empezar una nueva votación? Se borran las respuestas.')) socket.emit('reset');
    });

    socket.on('connect', hello);
    socket.on('disconnect', function () { toast('Se perdió la conexión con el servidor. Reconectando…', 4000); });
    socket.on('state', render);
  }

  if (IS_ADMIN) initAdmin();
  else initPlayer();
})();
