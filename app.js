(() => {
  'use strict';

  const MAX_FILE_BYTES = 500000;
  const MAX_MODEL_CHARACTERS = 24000;
  const MAX_MODEL_BYTES = 96000;
  const MAX_KEYS = 20;
  const MAX_ASSET_FILES = 25;
  const MAX_ASSET_BYTES = 1000000;
  const MAX_ASSET_FILE_BYTES = 500000;
  const ALLOWED_KEYS = [
    ['Tab', 'Tab'],
    ['Shift+Tab', 'Shift + Tab'],
    ['ArrowUp', 'Arrow Up'],
    ['ArrowDown', 'Arrow Down'],
    ['ArrowLeft', 'Arrow Left'],
    ['ArrowRight', 'Arrow Right'],
    ['Enter', 'Enter'],
    ['Escape', 'Escape'],
    ['Space', 'Space']
  ];

  const state = {
    workspace: null,
    proposal: null,
    selectedRepairs: new Set(),
    fixtureVerification: null,
    busy: new Set(),
    local: {
      file: null,
      validFile: false,
      source: null,
      assets: [],
      assetsValid: true,
      assetsError: '',
      ignoredAssetCount: 0,
      assetRootName: '',
      journey: [],
      baseline: null,
      proposal: null,
      verification: null
    }
  };

  const $ = (id) => document.getElementById(id);
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  async function requestJson(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
        cache: 'no-store',
        credentials: 'same-origin'
      });
    } catch (error) {
      throw new Error(`Could not reach the local AccessPatch server. ${error.message || ''}`.trim());
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* A non-JSON server failure is reported below. */ }
    if (!response.ok) {
      throw new Error(payload && typeof payload.error === 'string' ? payload.error : `Request failed (${response.status}).`);
    }
    return payload;
  }

  function setBusy(id, busy, label) {
    const button = $(id);
    if (!button) return;
    const text = button.querySelector('.button-label');
    if (busy) {
      state.busy.add(id);
      if (text) {
        if (!text.dataset.idle) text.dataset.idle = text.textContent;
        text.textContent = label || 'Working…';
      }
      button.setAttribute('aria-busy', 'true');
      if (!button.querySelector('.button-spinner')) {
        const spinner = create('span', 'spinner button-spinner');
        spinner.setAttribute('aria-hidden', 'true');
        button.insertBefore(spinner, text || button.firstChild);
      }
    } else {
      state.busy.delete(id);
      if (text && text.dataset.idle) text.textContent = text.dataset.idle;
      button.removeAttribute('aria-busy');
      button.querySelector('.button-spinner')?.remove();
    }
    syncButtons();
  }

  function setApiState(text, isError = false) {
    $('api-state-text').textContent = text;
    $('api-state').classList.toggle('is-error', isError);
  }

  function setWorkflow(stage) {
    const stages = ['inspect', 'propose', 'verify'];
    const activeIndex = stages.indexOf(stage);
    stages.forEach((name, index) => {
      const item = $(`step-${name}`);
      item.classList.toggle('is-current', index === activeIndex);
      item.classList.toggle('is-done', index < activeIndex);
      const stateText = item.querySelector('.step-state');
      if (stateText) stateText.textContent = index < activeIndex ? '✓' : (index === activeIndex ? '●' : '○');
    });
  }

  function showGlobalError(message) {
    const box = $('global-message');
    box.replaceChildren(document.createTextNode(message + ' '));
    const retry = create('button', '', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', loadWorkspace);
    box.append(retry);
    box.hidden = false;
  }

  function clearGlobalError() {
    $('global-message').hidden = true;
    $('global-message').replaceChildren();
  }

  function textOf(value, fallback = '') {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return fallback;
  }

  function modelName(model) {
    if (typeof model === 'string') return model;
    if (model && typeof model === 'object') return textOf(model.name || model.id || model.model, '');
    return '';
  }

  function sourceLabel(source) {
    if (source === 'browser') return 'Browser observed';
    if (source === 'source') return 'Source check';
    return textOf(source, 'Source not specified');
  }

  function statusClass(status) {
    if (status === 'pass') return 'is-pass';
    if (status === 'fail') return 'is-fail';
    return 'is-other';
  }

  function statusMark(status) {
    if (status === 'pass') return '✓';
    if (status === 'fail') return '!';
    return '·';
  }

  function renderSummary(summary) {
    const passed = Number.isFinite(Number(summary?.passed)) ? Number(summary.passed) : null;
    const total = Number.isFinite(Number(summary?.total)) ? Number(summary.total) : null;
    if (passed === null || total === null) return 'No check summary returned.';
    return `${passed} of ${total} checks passed`;
  }

  function renderCheckList(container, checks, compact = false) {
    container.replaceChildren();
    if (!Array.isArray(checks) || checks.length === 0) {
      container.append(create('div', 'empty-evidence', 'No checks were returned for this run.'));
      return;
    }
    checks.forEach((check) => {
      const row = create('div', compact ? `result-check ${statusClass(check.status)}` : `check-row ${statusClass(check.status)}`);
      const mark = create('span', compact ? 'result-mark' : 'check-icon', statusMark(check.status));
      mark.setAttribute('aria-hidden', 'true');
      const copy = create('div', compact ? 'result-check-copy' : 'check-copy');
      copy.append(create('strong', '', textOf(check.title, 'Untitled check')));
      if (check.detail) copy.append(create('p', '', check.detail));
      row.append(mark, copy);
      if (check.source) row.append(create('span', 'check-source', sourceLabel(check.source)));
      container.append(row);
    });
  }

  function renderTrace(container, trace, style = 'rail') {
    container.replaceChildren();
    if (!Array.isArray(trace) || trace.length === 0) {
      container.append(create('div', style === 'rail' ? 'trace-empty' : 'result-trace-empty', 'No focus steps were returned for this journey.'));
      return;
    }
    trace.forEach((step, index) => {
      const ordinal = step.step !== undefined && step.step !== null ? textOf(step.step) : String(index + 1);
      const name = textOf(step.name || step.target, 'Focus target not reported');
      const role = textOf(step.role, 'Role not reported');
      if (style === 'rail') {
        const item = create('div', 'trace-step');
        if (step.status === 'fail') item.classList.add('is-failure');
        item.title = [name, role].filter(Boolean).join(' · ');
        const point = create('span', 'trace-point', ordinal);
        point.setAttribute('aria-hidden', 'true');
        item.append(point, create('strong', '', name), create('span', '', role));
        container.append(item);
      } else {
        const item = create('span', 'result-trace-step');
        if (step.status === 'fail') item.classList.add('is-failure');
        const key = textOf(step.key, ordinal);
        item.append(create('span', '', key), create('strong', '', `${name}${role ? ` · ${role}` : ''}`));
        item.title = `${key}: ${name} (${role})`;
        container.append(item);
      }
    });
  }

  function renderWorkspace(workspace) {
    state.workspace = workspace;
    const fixture = workspace?.fixture || {};
    const audit = workspace?.audit || {};
    $('fixture-title').textContent = textOf(fixture.title, 'Untitled controlled fixture');
    $('fixture-description').textContent = textOf(fixture.description, 'No fixture description returned.');
    $('fixture-source').textContent = textOf(fixture.source, 'No fixture source returned.');
    $('baseline-summary').textContent = renderSummary(audit.summary);
    renderCheckList($('baseline-checks'), audit.checks);
    renderTrace($('baseline-trace'), audit.keyboard, 'rail');
    $('fixture-panel').setAttribute('aria-busy', 'false');
    setApiState('Local workspace ready');
    setWorkflow('inspect');
    syncButtons();
  }

  async function loadWorkspace() {
    clearGlobalError();
    $('fixture-panel').setAttribute('aria-busy', 'true');
    setApiState('Loading local workspace');
    $('baseline-summary').textContent = 'Waiting for fixture evidence…';
    $('baseline-checks').replaceChildren(create('div', 'loading-line', 'Loading browser checks…'));
    try {
      const data = await requestJson('/api/workspace');
      if (!data.fixture || !data.audit) throw new Error('The local server returned an incomplete workspace response.');
      renderWorkspace(data);
    } catch (error) {
      $('fixture-panel').setAttribute('aria-busy', 'false');
      $('baseline-checks').replaceChildren(create('div', 'empty-evidence', 'Fixture evidence is unavailable until the local server responds.'));
      $('baseline-summary').textContent = 'Workspace not loaded';
      setApiState('Local server unavailable', true);
      showGlobalError(error.message);
    }
  }

  function renderUncertainty(container, uncertainties) {
    container.replaceChildren();
    if (!Array.isArray(uncertainties) || uncertainties.length === 0) {
      container.append(create('li', '', 'No uncertainty statements were returned.'));
      return;
    }
    uncertainties.forEach((item) => {
      const value = typeof item === 'string' ? item : textOf(item?.text || item?.statement, JSON.stringify(item));
      container.append(create('li', '', value));
    });
  }

  function renderProposal(proposal, model) {
    state.proposal = proposal;
    state.selectedRepairs = new Set();
    $('proposal-area').setAttribute('aria-busy', 'false');
    $('proposal-area').replaceChildren();
    $('model-output-panel').hidden = false;
    $('proposal-summary').textContent = textOf(proposal?.summary, 'No proposal summary was returned.');
    $('model-label').textContent = modelName(model);
    renderUncertainty($('uncertainty-list'), proposal?.uncertainties);
    $('raw-proposal').textContent = JSON.stringify({ proposal, model }, null, 2);

    const repairs = Array.isArray(proposal?.repairs) ? proposal.repairs : [];
    const area = $('repair-options');
    area.replaceChildren();
    if (repairs.length === 0) {
      area.append(create('div', 'empty-evidence', 'No selectable repairs were returned.'));
      $('selection-controls').hidden = true;
    } else {
      repairs.forEach((repair) => {
        const label = create('label', 'repair-option');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = textOf(repair.id);
        input.dataset.repairId = textOf(repair.id);
        input.setAttribute('aria-label', `Select repair ${textOf(repair.id)}: ${textOf(repair.reason, 'No reason returned')}`);
        input.addEventListener('change', () => {
          if (input.checked) state.selectedRepairs.add(input.dataset.repairId);
          else state.selectedRepairs.delete(input.dataset.repairId);
          updateSelectionState();
        });
        const copy = create('span', 'repair-option-copy');
        copy.append(create('strong', '', textOf(repair.reason, 'Repair reason not provided')));
        copy.append(create('span', 'repair-id', `ID · ${textOf(repair.id, 'not returned')}`));
        label.append(input, copy);
        area.append(label);
      });
      $('selection-controls').hidden = false;
    }
    $('model-output-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setWorkflow('propose');
    updateSelectionState();
  }

  function updateSelectionState() {
    $('selection-count').textContent = `${state.selectedRepairs.size} selected`;
    if (state.fixtureVerification) {
      state.fixtureVerification = null;
      $('verification-results').hidden = true;
      $('verification-placeholder').hidden = false;
      $('verification-stale').hidden = false;
      $('verification-state').textContent = 'Selection changed';
      $('verification-state').className = 'verification-state is-stale';
      $('copy-diff-button').disabled = true;
    }
    const verifyButton = $('verify-button');
    verifyButton.disabled = state.selectedRepairs.size === 0 || state.busy.has('verify-button');
    $('verification-error').hidden = true;
    syncButtons();
  }

  function syncButtons() {
    $('propose-button').disabled = !state.workspace || state.busy.has('propose-button');
    $('verify-button').disabled = !state.proposal || state.selectedRepairs.size === 0 || state.busy.has('verify-button');

    const fileReady = state.local.validFile && state.local.file;
    const journeyReady = state.local.journey.length >= 1 && state.local.journey.length <= MAX_KEYS;
    const bundleReady = state.local.assetsValid;
    const sourceReady = typeof state.local.source === 'string';
    const canRun = fileReady && bundleReady && journeyReady && $('run-consent').checked;
    $('inspect-local-button').disabled = !canRun || state.busy.has('inspect-local-button');
    const modelChars = sourceReady ? Array.from(state.local.source).length : 0;
    const modelBytes = sourceReady ? new TextEncoder().encode(state.local.source).byteLength : 0;
    const modelOverLimit = sourceReady && (modelChars > MAX_MODEL_CHARACTERS || modelBytes > MAX_MODEL_BYTES);
    $('propose-local-button').disabled = !fileReady || (sourceReady && (modelChars === 0 || modelOverLimit)) || !$('model-consent').checked || state.busy.has('propose-local-button');
    $('verify-local-button').disabled = !state.local.proposal?.candidate_source || !canRun || state.busy.has('verify-local-button');
    $('add-key-button').disabled = state.local.journey.length >= MAX_KEYS;
    if (sourceReady && modelOverLimit) {
      $('file-error').textContent = `This source is ${modelChars.toLocaleString()} characters / ${modelBytes.toLocaleString()} UTF-8 bytes. Model proposals are limited to ${MAX_MODEL_CHARACTERS.toLocaleString()} characters and ${MAX_MODEL_BYTES.toLocaleString()} bytes; local inspection can still run.`;
      $('file-error').hidden = false;
    }
  }

  function setFixtureError(message) {
    const box = $('verification-error');
    box.textContent = message;
    box.hidden = false;
  }

  function renderResultTrace(container, trace) {
    renderTrace(container, trace, 'result');
  }

  function renderDiff(container, diff) {
    container.replaceChildren();
    const lines = typeof diff === 'string' ? diff.split('\n') : [];
    if (!lines.length || (lines.length === 1 && !lines[0])) {
      container.append(create('span', 'diff-line', 'No diff was returned.'));
      return;
    }
    lines.forEach((line) => {
      let className = 'diff-line';
      if (line.startsWith('+') && !line.startsWith('+++')) className += ' is-add';
      else if (line.startsWith('-') && !line.startsWith('---')) className += ' is-remove';
      else if (line.startsWith('@@') || line.startsWith('diff ')) className += ' is-meta';
      container.append(create('span', className, line || ' '));
    });
  }

  function renderLimitations(container, list) {
    const panel = container.closest('.limitations-panel');
    container.replaceChildren();
    if (!Array.isArray(list) || list.length === 0) {
      if (panel) panel.hidden = true;
      return;
    }
    list.forEach((item) => {
      container.append(create('li', '', textOf(item?.text || item, JSON.stringify(item))));
    });
    if (panel) panel.hidden = false;
  }

  function renderFixtureVerification(data) {
    $('verification-placeholder').hidden = true;
    $('verification-stale').hidden = true;
    $('verification-results').hidden = false;
    $('verification-error').hidden = true;
    $('before-summary').textContent = renderSummary(data.before?.summary);
    $('after-summary').textContent = renderSummary(data.after?.summary);
    renderCheckList($('before-checks'), data.before?.checks, true);
    renderCheckList($('after-checks'), data.after?.checks, true);
    renderResultTrace($('before-trace'), data.before?.keyboard);
    renderResultTrace($('after-trace'), data.after?.keyboard);
    renderDiff($('diff-output'), data.diff);
    $('copy-diff-button').disabled = typeof data.diff !== 'string' || data.diff.length === 0;
    const passed = Number(data.after?.summary?.passed);
    const total = Number(data.after?.summary?.total);
    const allPass = Number.isFinite(passed) && Number.isFinite(total) && total > 0 && passed === total;
    $('verification-state').textContent = allPass ? 'All observed checks passed' : `${renderSummary(data.after?.summary)}`;
    $('verification-state').className = `verification-state ${allPass ? 'is-success' : 'is-mixed'}`;
  }

  async function proposeFixture() {
    setBusy('propose-button', true, 'Requesting options…');
    $('proposal-area').setAttribute('aria-busy', 'true');
    $('proposal-area').replaceChildren(create('div', 'proposal-loading', ''));
    const loading = $('proposal-area').firstChild;
    const spinner = create('span', 'spinner');
    spinner.setAttribute('aria-hidden', 'true');
    loading.append(spinner, document.createTextNode('Requesting bounded repair options…'));
    $('model-output-panel').hidden = true;
    try {
      const data = await requestJson('/api/propose', { method: 'POST', body: JSON.stringify({}) });
      renderProposal(data.proposal || {}, data.model);
    } catch (error) {
      $('proposal-area').setAttribute('aria-busy', 'false');
      $('proposal-area').replaceChildren();
      const box = create('div', 'proposal-error');
      box.append(document.createTextNode(`${error.message} `));
      const retry = create('button', '', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', proposeFixture);
      box.append(retry);
      $('proposal-area').append(box);
    } finally {
      setBusy('propose-button', false);
    }
  }

  async function verifyFixture() {
    if (!state.proposal || state.selectedRepairs.size === 0) return;
    setBusy('verify-button', true, 'Verifying…');
    $('verification-placeholder').hidden = true;
    $('verification-results').hidden = true;
    $('verification-stale').hidden = true;
    $('verification-error').hidden = true;
    $('verification-state').textContent = 'Running verification';
    $('verification-state').className = 'verification-state';
    try {
      const data = await requestJson('/api/verify', {
        method: 'POST',
        body: JSON.stringify({ repair_ids: Array.from(state.selectedRepairs) })
      });
      state.fixtureVerification = data;
      renderFixtureVerification(data);
      setWorkflow('verify');
      $('verification-section').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) {
      $('verification-placeholder').hidden = false;
      $('verification-state').textContent = 'Verification failed';
      $('verification-state').className = 'verification-state is-mixed';
      setFixtureError(error.message);
    } finally {
      setBusy('verify-button', false);
    }
  }

  function renderJourney() {
    const list = $('journey-steps');
    list.replaceChildren();
    state.local.journey.forEach((key, index) => {
      const row = create('li', 'journey-row');
      const number = create('span', 'journey-index', String(index + 1).padStart(2, '0'));
      number.setAttribute('aria-hidden', 'true');
      const select = document.createElement('select');
      select.className = 'journey-key-select';
      select.setAttribute('aria-label', `Key for journey step ${index + 1}`);
      ALLOWED_KEYS.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === key;
        select.append(option);
      });
      select.addEventListener('change', () => {
        state.local.journey[index] = select.value;
        journeyChanged();
      });
      const actions = create('span', 'journey-row-actions');
      const up = create('button', 'journey-move-button', '↑');
      up.type = 'button';
      up.disabled = index === 0;
      up.setAttribute('aria-label', `Move step ${index + 1} up`);
      up.addEventListener('click', () => moveJourneyStep(index, -1));
      const down = create('button', 'journey-move-button', '↓');
      down.type = 'button';
      down.disabled = index === state.local.journey.length - 1;
      down.setAttribute('aria-label', `Move step ${index + 1} down`);
      down.addEventListener('click', () => moveJourneyStep(index, 1));
      const remove = create('button', 'journey-remove-button', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove step ${index + 1}, ${ALLOWED_KEYS.find(([value]) => value === key)?.[1] || key}`);
      remove.addEventListener('click', () => {
        state.local.journey.splice(index, 1);
        journeyChanged();
      });
      actions.append(up, down, remove);
      row.append(number, select, actions);
      list.append(row);
    });
    $('journey-empty').hidden = state.local.journey.length > 0;
    $('journey-count').textContent = `${state.local.journey.length} / ${MAX_KEYS}`;
    syncButtons();
  }

  function moveJourneyStep(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= state.local.journey.length) return;
    [state.local.journey[index], state.local.journey[target]] = [state.local.journey[target], state.local.journey[index]];
    journeyChanged();
  }

  function renderLocalEmptyBaseline(message = 'Choose a trusted file, add a keyboard journey, opt in to local execution, then capture its focus path.') {
    const output = $('local-baseline-output');
    output.replaceChildren();
    const empty = create('div', 'local-output-empty');
    empty.append(create('span', '', '⌁'), create('strong', '', 'Baseline not captured'), create('p', '', message));
    output.append(empty);
  }

  function localEvidenceWarning() {
    const warning = create('div', 'local-evidence-warning');
    warning.setAttribute('role', 'note');
    warning.append(create('span', 'evidence-warning-icon', '!'));
    const copy = create('p', '');
    copy.append(create('strong', '', 'This browser run can differ from the deployed page.'));
    copy.append(document.createTextNode(' The HTTP resource log covers intercepted HTTP requests only; other browser resource mechanisms may not appear. Visually hidden controls can appear in the keyboard trace. This is evidence for this run, not proof of accessibility.'));
    warning.append(copy);
    return warning;
  }

  function resourceCounts(resources) {
    if (!resources || typeof resources !== 'object') return null;
    return {
      loaded: Array.isArray(resources.loaded) ? resources.loaded : [],
      missing: Array.isArray(resources.missing) ? resources.missing : [],
      blocked: Array.isArray(resources.blocked) ? resources.blocked : [],
      truncated: resources.truncated === true
    };
  }

  function renderResourceWarning(runs) {
    const warning = localEvidenceWarning();
    const copy = warning.querySelector('p');
    const reports = (Array.isArray(runs) ? runs : [{ label: 'This run', resources: runs }])
      .map((run) => ({ label: run.label || 'This run', counts: resourceCounts(run.resources) }));
    const available = reports.filter((report) => report.counts);
    if (!available.length) {
      copy.append(document.createTextNode(' Intercepted HTTP resource details were not returned, so selected asset loading cannot be confirmed from this report.'));
      return warning;
    }
    const countsLine = create('span', 'resource-counts', `Intercepted HTTP request records: ${available.map(({ label, counts }) => `${label}: ${counts.loaded.length} selected CSS/JS responses · ${counts.missing.length} missing local resources · ${counts.blocked.length} blocked`).join(' | ')}`);
    copy.append(document.createElement('br'), countsLine);
    if (reports.some(({ counts }) => counts?.truncated)) copy.append(document.createTextNode(' At least one run reached the 200-record cap; the displayed resource lists and counts are partial.'));
    else if (available.some(({ counts }) => counts.missing.length || counts.blocked.length)) copy.append(document.createTextNode(' Missing or blocked HTTP resources can change layout and keyboard behavior.'));
    if (available.length < reports.length) copy.append(document.createTextNode(' HTTP resource details were missing for at least one run.'));
    return warning;
  }

  function renderResourceReport(container, resources) {
    const counts = resourceCounts(resources);
    const details = create('details', 'resource-details');
    const summary = create('summary', 'resource-summary');
    const label = counts
      ? `Intercepted HTTP log · ${counts.loaded.length} selected CSS/JS served · ${counts.missing.length} missing local · ${counts.blocked.length} blocked${counts.truncated ? ' · partial list' : ''}`
      : 'Intercepted HTTP log · unavailable';
    summary.append(create('span', 'resource-summary-icon', '↗'), create('span', '', label));
    details.append(summary);
    const body = create('div', 'resource-report-body');
    if (!counts) {
      body.append(create('p', 'resource-empty', 'The server did not return HTTP resource details for this run.'));
    } else {
      const groups = [
        ['Served from selected CSS/JS', counts.loaded, (item) => `${textOf(item.path, 'path not returned')} ← ${textOf(item.url, 'URL not returned')}`, 'is-loaded'],
        ['Missing local HTTP resources', counts.missing, (item) => textOf(item.url, 'URL not returned'), 'is-missing'],
        ['Blocked HTTP requests', counts.blocked, (item) => textOf(item.url, 'URL not returned'), 'is-blocked']
      ];
      groups.forEach(([title, entries, format, tone]) => {
        const group = create('section', `resource-group ${tone}`);
        group.append(create('h5', '', `${title} (${entries.length})`));
        if (!entries.length) group.append(create('p', 'resource-empty', 'No records returned.'));
        else {
          const list = create('ul', 'resource-list');
          entries.slice(0, 30).forEach((entry) => list.append(create('li', '', format(entry))));
          if (entries.length > 30) list.append(create('li', 'resource-more', `${entries.length - 30} more returned records not shown.`));
          group.append(list);
        }
        body.append(group);
      });
      if (counts.truncated) body.append(create('p', 'resource-truncated', 'The audit stopped recording HTTP resource details after 200 requests; counts and lists are partial.'));
    }
    details.append(body);
    container.append(details);
  }

  function renderLocalAudit(container, audit, limitations, title = 'Baseline captured') {
    container.replaceChildren();
    container.append(renderResourceWarning([{ label: 'Baseline', resources: audit?.resources }]));
    const heading = create('div', 'local-report-heading');
    heading.append(create('span', 'local-report-dot', '✓'));
    const copy = create('div');
    copy.append(create('strong', '', title), create('small', '', renderSummary(audit?.summary)));
    heading.append(copy);
    container.append(heading);
    renderResourceReport(container, audit?.resources);
    const checksTitle = create('h4', 'local-result-heading', 'Observed checks');
    container.append(checksTitle);
    const checks = create('div', 'local-checks');
    renderCheckList(checks, audit?.checks, true);
    container.append(checks);
    const traceHead = create('h4', 'local-result-heading', 'Keyboard focus trace');
    container.append(traceHead);
    container.append(create('p', 'local-trace-note', 'Focused element is browser-observed; role and name are DOM-based approximations, not platform accessibility-tree values.'));
    const trace = create('div', 'local-trace');
    renderResultTrace(trace, audit?.keyboard);
    container.append(trace);
    if (Array.isArray(limitations) && limitations.length) {
      const list = create('ul', 'local-limit-list');
      limitations.forEach((item) => list.append(create('li', '', textOf(item?.text || item, JSON.stringify(item)))));
      const group = create('div', 'local-result-limitations');
      group.append(create('strong', '', 'Returned limitations'), list);
      container.append(group);
    }
  }

  function clearLocalVerification() {
    state.local.verification = null;
    $('local-verify-output').hidden = true;
    $('local-verify-output').replaceChildren();
    $('download-candidate-button').hidden = true;
    $('download-report-button').hidden = true;
  }

  function journeyChanged() {
    state.local.baseline = null;
    $('run-consent').checked = false;
    renderJourney();
    renderLocalEmptyBaseline('The keyboard sequence changed. Capture a fresh baseline for this exact journey.');
    clearLocalVerification();
    if (state.local.file) setLocalStatus('Journey changed. Capture a fresh baseline or verify again with this exact key sequence.');
  }

  function clearLocalOutputs() {
    state.local.source = null;
    state.local.baseline = null;
    state.local.proposal = null;
    state.local.verification = null;
    renderLocalEmptyBaseline();
    $('local-proposal-output').replaceChildren();
    const empty = create('div', 'local-output-empty subdued-empty');
    empty.append(create('span', '', '✳'), create('strong', '', 'No model proposal'), create('p', '', 'The model only sees this file after you opt in and request a repair.'));
    $('local-proposal-output').append(empty);
    $('local-verify-controls').hidden = true;
    $('local-verify-output').hidden = true;
    $('local-verify-output').replaceChildren();
    $('download-candidate-button').hidden = true;
    $('download-report-button').hidden = true;
    $('run-consent').checked = false;
    $('model-consent').checked = false;
    $('file-error').hidden = true;
    syncButtons();
  }

  function setLocalStatus(message, isError = false) {
    const status = $('local-action-status');
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function handleFileChange() {
    const file = $('html-file').files?.[0] || null;
    state.local.file = file;
    const isHtml = !!file && /\.html?$/i.test(file.name);
    const sizeOk = !!file && file.size <= MAX_FILE_BYTES;
    state.local.validFile = !!file && isHtml && sizeOk;
    clearLocalOutputs();
    if (!file) {
      $('file-selection-status').textContent = 'File stays in this tab until you choose an action.';
      $('file-error').hidden = true;
      setLocalStatus('Choose a file and add at least one key to begin.');
    } else if (!isHtml) {
      $('file-selection-status').textContent = 'Unsupported file type.';
      $('file-error').textContent = 'Choose one .html or .htm file.';
      $('file-error').hidden = false;
      setLocalStatus('This flow accepts one .html or .htm file.', true);
    } else if (!sizeOk) {
      $('file-selection-status').textContent = 'File exceeds the local inspection limit.';
      $('file-error').textContent = `This file exceeds the 500,000-byte limit. Choose a smaller HTML file.`;
      $('file-error').hidden = false;
      setLocalStatus('The file is too large for local inspection.', true);
    } else {
      $('file-selection-status').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · source not read yet`;
      $('file-error').hidden = true;
      setLocalStatus('File selected. Add the key sequence, then choose baseline, model proposal, or both.');
    }
    syncButtons();
  }

  function normalizeAssetPath(file) {
    const raw = file.webkitRelativePath || file.name;
    const parts = raw.split('/');
    if (file.webkitRelativePath && parts.length > 1) parts.shift();
    return parts.join('/');
  }

  function validAssetPath(path) {
    if (!path || path.length > 240 || path.startsWith('/')) return false;
    const parts = path.split('/');
    return parts.every((part) => part && part !== '.' && part !== '..' && /^[A-Za-z0-9_. -]+$/.test(part)) && /\.(?:css|js|mjs)$/i.test(path);
  }

  function refreshAssetSelection() {
    const list = $('asset-list');
    list.replaceChildren();
    state.local.assets.forEach((asset, index) => {
      const item = create('li', 'asset-file-row');
      const name = create('code', 'asset-file-path', asset.path);
      const metadata = create('span', 'asset-file-size', `${(asset.file.size / 1024).toFixed(1)} KB · ${asset.path.toLowerCase().endsWith('.css') ? 'CSS' : 'JavaScript'}`);
      const copy = create('span', 'asset-file-copy');
      copy.append(name, metadata);
      const remove = create('button', 'asset-remove-button', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove selected asset ${asset.path}`);
      remove.addEventListener('click', () => {
        state.local.assets.splice(index, 1);
        state.local.assetsError = '';
        state.local.assetsValid = true;
        state.local.ignoredAssetCount = 0;
        state.local.assetRootName = '';
        invalidateAssetEvidence();
        refreshAssetSelection();
      });
      item.append(copy, remove);
      list.append(item);
    });
    const count = state.local.assets.length;
    $('asset-count').textContent = `${count} ${count === 1 ? 'file' : 'files'}`;
    $('clear-assets-button').hidden = count === 0 && state.local.assetsValid;

    if (state.local.assetsError) {
      $('asset-error').textContent = state.local.assetsError;
      $('asset-error').className = 'field-error';
      $('asset-error').hidden = false;
      $('asset-selection-status').textContent = 'Asset selection rejected; no assets will be sent.';
    } else if (count) {
      const root = state.local.assetRootName ? ` from “${state.local.assetRootName}”` : '';
      $('asset-selection-status').textContent = `${count} CSS/JS file${count === 1 ? '' : 's'}${root}; only listed paths are sent to the local server.`;
      if (state.local.ignoredAssetCount) {
        $('asset-error').textContent = `${state.local.ignoredAssetCount} non-CSS/JS file${state.local.ignoredAssetCount === 1 ? '' : 's'} ignored. References to those files may be missing or blocked.`;
        $('asset-error').className = 'field-info';
        $('asset-error').hidden = false;
      } else {
        $('asset-error').hidden = true;
      }
    } else {
      $('asset-selection-status').textContent = 'No CSS/JS folder selected. This step is optional.';
      if (state.local.ignoredAssetCount) {
        $('asset-error').textContent = `No CSS/JS files found. ${state.local.ignoredAssetCount} other file${state.local.ignoredAssetCount === 1 ? ' was' : 's were'} ignored.`;
        $('asset-error').className = 'field-info';
        $('asset-error').hidden = false;
      } else {
        $('asset-error').hidden = true;
      }
    }
    syncButtons();
  }

  function invalidateAssetEvidence() {
    state.local.baseline = null;
    $('run-consent').checked = false;
    renderLocalEmptyBaseline('The selected asset bundle changed. Capture a new baseline with this exact HTML and bundle.');
    clearLocalVerification();
    if (state.local.file) setLocalStatus('Asset selection changed. Review the file list and confirm local execution again.');
  }

  function handleAssetFolderChange() {
    const selected = Array.from($('asset-folder').files || []);
    $('asset-folder').value = '';
    const supported = selected.filter((file) => /\.(?:css|js|mjs)$/i.test(file.name));
    state.local.ignoredAssetCount = selected.length - supported.length;
    state.local.assetRootName = selected[0]?.webkitRelativePath?.split('/')[0] || '';
    state.local.assetsError = '';
    state.local.assetsValid = true;
    const normalized = supported.map((file) => ({ file, path: normalizeAssetPath(file) }));
    const seen = new Set();
    let totalBytes = 0;
    for (const asset of normalized) {
      if (!validAssetPath(asset.path)) {
        state.local.assetsError = `Invalid relative path “${asset.path}”. Use CSS/JS files with a relative path containing letters, numbers, spaces, dots, underscores or hyphens only.`;
        break;
      }
      if (seen.has(asset.path)) {
        state.local.assetsError = `Duplicate relative path “${asset.path}”. Select one copy of each CSS/JS path.`;
        break;
      }
      seen.add(asset.path);
      if (asset.file.size > MAX_ASSET_FILE_BYTES) {
        state.local.assetsError = `${asset.path} exceeds the 500,000-byte per-file limit.`;
        break;
      }
      totalBytes += asset.file.size;
    }
    if (!state.local.assetsError && normalized.length > MAX_ASSET_FILES) {
      state.local.assetsError = `The selected folder contains ${normalized.length} CSS/JS files. Select at most ${MAX_ASSET_FILES} files.`;
    }
    if (!state.local.assetsError && totalBytes > MAX_ASSET_BYTES) {
      state.local.assetsError = 'The selected CSS/JS files exceed the 1,000,000-byte total limit.';
    }
    if (state.local.assetsError) {
      state.local.assets = [];
      state.local.assetsValid = false;
    } else {
      state.local.assets = normalized;
    }
    invalidateAssetEvidence();
    refreshAssetSelection();
  }

  function clearSelectedAssets() {
    state.local.assets = [];
    state.local.assetsValid = true;
    state.local.assetsError = '';
    state.local.ignoredAssetCount = 0;
    state.local.assetRootName = '';
    $('asset-folder').value = '';
    invalidateAssetEvidence();
    refreshAssetSelection();
  }

  async function readSelectedAssets() {
    if (!state.local.assetsValid) throw new Error(state.local.assetsError || 'Choose a valid relative CSS/JS bundle or clear the selected assets.');
    const assets = [];
    let totalBytes = 0;
    for (const asset of state.local.assets) {
      let content;
      let bytes;
      try {
        const buffer = await asset.file.arrayBuffer();
        bytes = buffer.byteLength;
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch (error) {
        throw new Error(`${asset.path} could not be decoded as UTF-8 CSS/JS text. ${error.message || ''}`.trim());
      }
      if (bytes > MAX_ASSET_FILE_BYTES) throw new Error(`${asset.path} exceeds the 500,000-byte per-file limit after UTF-8 decoding.`);
      totalBytes += bytes;
      if (totalBytes > MAX_ASSET_BYTES) throw new Error('The selected CSS/JS files exceed the 1,000,000-byte total limit after UTF-8 decoding.');
      assets.push({ path: asset.path, content });
    }
    return assets;
  }

  async function readSelectedSource() {
    if (!state.local.validFile || !state.local.file) throw new Error('Choose one .html or .htm file of 500 KB or less.');
    if (state.local.source !== null) return state.local.source;
    setLocalStatus('Reading the selected file in this tab…');
    let source;
    try { source = await state.local.file.text(); }
    catch (error) { throw new Error(`Could not read the selected file. ${error.message || ''}`.trim()); }
    if (typeof source !== 'string' || source.length === 0) throw new Error('The selected file is empty or could not be read as text.');
    state.local.source = source;
    const characterCount = Array.from(source).length;
    $('file-selection-status').textContent = `${state.local.file.name} · ${(state.local.file.size / 1024).toFixed(1)} KB · ${characterCount.toLocaleString()} characters read into this tab`;
    syncButtons();
    return source;
  }

  function currentJourney() {
    return state.local.journey.slice();
  }

  async function captureLocalBaseline() {
    if (!state.local.validFile || !state.local.assetsValid || !state.local.journey.length || !$('run-consent').checked) return;
    setBusy('inspect-local-button', true, 'Capturing…');
    setLocalStatus('Starting a fresh local browser run…');
    try {
      const source = await readSelectedSource();
      const assets = await readSelectedAssets();
      const data = await requestJson('/api/inspect', {
        method: 'POST',
        body: JSON.stringify({ source, journey: currentJourney(), assets, consent: true })
      });
      state.local.baseline = data;
      renderLocalAudit($('local-baseline-output'), data.audit || {}, data.limitations, 'Baseline captured');
      setLocalStatus('Baseline captured for the selected keyboard journey. No model was called.');
    } catch (error) {
      setLocalStatus(error.message, true);
      $('local-baseline-output').replaceChildren(create('div', 'local-action-error', error.message));
    } finally {
      $('run-consent').checked = false;
      setBusy('inspect-local-button', false);
    }
  }

  function renderLocalProposal(data) {
    state.local.proposal = data;
    const output = $('local-proposal-output');
    output.replaceChildren();
    const proposal = data.proposal || {};
    const top = create('div', 'local-proposal-card');
    const head = create('div', 'local-proposal-top');
    const badge = create('span', 'local-model-badge', 'N');
    badge.setAttribute('aria-hidden', 'true');
    const metadata = create('div', 'local-proposal-meta');
    metadata.append(create('strong', '', 'Model repair proposal'));
    const model = modelName(data.model);
    if (model) metadata.append(create('small', '', model));
    head.append(badge, metadata);
    top.append(head);
    top.append(create('h4', 'local-result-heading', 'Model-stated summary · unverified'));
    top.append(create('p', 'local-proposal-summary', textOf(proposal.summary, 'No proposal summary was returned.')));

    const repairs = Array.isArray(proposal.repairs) ? proposal.repairs : [];
    const repairTitle = create('h4', 'local-result-heading', `Accepted edits included in candidate (${repairs.length})`);
    top.append(repairTitle);
    const repairList = create('div', 'local-repair-list');
    if (repairs.length === 0) repairList.append(create('div', 'empty-evidence', 'No edits passed AccessPatch’s bounded checks. The model summary may describe suggestions that were not accepted; it is not a verified finding.'));
    repairs.forEach((repair, index) => {
      const item = create('article', 'local-repair-item');
      const headRow = create('div', 'local-repair-item-heading');
      headRow.append(create('span', 'repair-number', String(index + 1).padStart(2, '0')));
      headRow.append(create('code', 'repair-id', textOf(repair.id, 'repair id not returned')));
      item.append(headRow);
      item.append(create('p', 'local-repair-reason', textOf(repair.reason, 'No reason returned.')));
      const edit = create('div', 'attribute-edit');
      edit.append(create('code', 'attribute-tag', textOf(repair.original_tag, 'tag not returned')));
      edit.append(create('span', 'attribute-arrow', '→'));
      const attr = create('code', 'attribute-value', repair.attribute === 'native-button'
        ? 'Replace with <button type="button">'
        : `${textOf(repair.attribute, 'attribute')}="${textOf(repair.value, '')}"`);
      edit.append(attr);
      item.append(edit);
      repairList.append(item);
    });
    top.append(repairList);
    const uncertainties = create('div', 'local-uncertainty');
    uncertainties.append(create('strong', '', 'Model-stated uncertainty'));
    const uncertaintyList = create('ul', '');
    renderUncertainty(uncertaintyList, proposal.uncertainties);
    uncertainties.append(uncertaintyList);
    top.append(uncertainties);
    top.append(create('p', 'model-review-note', 'The model-stated summary is unverified. Only the accepted edits above are included in this candidate diff. Review each edit against the source before verification; nothing is applied automatically.'));
    if (Array.isArray(data.limitations) && data.limitations.length) {
      const limit = create('div', 'local-result-limitations');
      limit.append(create('strong', '', 'Returned limitations'));
      const list = create('ul', 'local-limit-list');
      data.limitations.forEach((item) => list.append(create('li', '', textOf(item?.text || item, JSON.stringify(item)))));
      limit.append(list);
      top.append(limit);
    }
    output.append(top);

    const diffCard = create('div', 'local-diff-card');
    const diffHeading = create('div', 'local-diff-title');
    diffHeading.append(create('strong', '', 'Proposed source diff'), create('span', '', 'NOT APPLIED'));
    diffCard.append(diffHeading);
    const pre = create('pre', 'diff-block local-diff-block');
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', 'Local HTML proposed source diff');
    const code = document.createElement('code');
    renderDiff(code, data.diff);
    pre.append(code);
    diffCard.append(pre);
    output.append(diffCard);
    $('local-verify-controls').hidden = !data.candidate_source;
    syncButtons();
  }

  async function proposeLocalRepair() {
    if (!$('model-consent').checked) return;
    state.local.proposal = null;
    clearLocalVerification();
    $('local-verify-controls').hidden = true;
    setBusy('propose-local-button', true, 'Requesting…');
    setLocalStatus('Sending the selected HTML to the configured model for a bounded proposal…');
    try {
      const source = await readSelectedSource();
      const characterCount = Array.from(source).length;
      const byteCount = new TextEncoder().encode(source).byteLength;
      if (characterCount > MAX_MODEL_CHARACTERS || byteCount > MAX_MODEL_BYTES) throw new Error(`This file is ${characterCount.toLocaleString()} characters / ${byteCount.toLocaleString()} UTF-8 bytes. The model request limit is ${MAX_MODEL_CHARACTERS.toLocaleString()} characters and ${MAX_MODEL_BYTES.toLocaleString()} bytes; local inspection can still run.`);
      const data = await requestJson('/api/local-propose', {
        method: 'POST',
        body: JSON.stringify({ source, consent: true })
      });
      if (typeof data.candidate_source !== 'string') throw new Error('The server returned no candidate source to review.');
      renderLocalProposal(data);
      setLocalStatus('Proposal received. Review its bounded edits and diff; nothing has been applied or run.');
    } catch (error) {
      const output = $('local-proposal-output');
      output.replaceChildren(create('div', 'local-action-error', error.message));
      state.local.proposal = null;
      $('local-verify-controls').hidden = true;
      setLocalStatus(error.message, true);
    } finally {
      $('model-consent').checked = false;
      setBusy('propose-local-button', false);
    }
  }

  function renderLocalComparison(data) {
    const output = $('local-verify-output');
    output.replaceChildren();
    output.append(renderResourceWarning([
      { label: 'Before', resources: data.before?.resources },
      { label: 'After', resources: data.after?.resources }
    ]));
    const banner = create('div', 'local-run-banner');
    banner.append(create('span', 'method-dot'), create('span', '', 'Fresh Chromium · keyboard-only · HTTP/WebSocket intercepted · other paths may remain'), create('strong', '', 'OBSERVED'));
    output.append(banner);
    const grid = create('div', 'local-comparison-grid');
    [
      ['Before', 'BASELINE', data.before],
      ['After', 'CANDIDATE', data.after]
    ].forEach(([title, tag, result]) => {
      const card = create('article', `local-compare-card ${title === 'After' ? 'candidate-compare' : ''}`);
      const heading = create('div', 'local-compare-heading');
      heading.append(create('h4', '', title), create('span', '', tag));
      card.append(heading, create('p', 'local-compare-summary', renderSummary(result?.summary)));
      renderResourceReport(card, result?.resources);
      card.append(create('h5', 'local-result-heading', 'Checks'));
      const checks = create('div', 'local-checks');
      renderCheckList(checks, result?.checks, true);
      card.append(checks, create('h5', 'local-result-heading', 'Keyboard focus trace'));
      const trace = create('div', 'local-trace');
      renderResultTrace(trace, result?.keyboard);
      card.append(create('p', 'local-trace-note', 'Focus is browser-observed; role and name are DOM-based approximations.'));
      card.append(trace);
      grid.append(card);
    });
    output.append(grid);
    const diffCard = create('div', 'local-diff-card');
    const title = create('div', 'local-diff-title');
    title.append(create('strong', '', 'Verified candidate diff'), create('span', '', 'CANDIDATE ONLY'));
    diffCard.append(title);
    const pre = create('pre', 'diff-block local-diff-block');
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', 'Verified local candidate diff');
    const code = document.createElement('code');
    renderDiff(code, data.diff);
    pre.append(code);
    diffCard.append(pre);
    output.append(diffCard);
    if (Array.isArray(data.limitations) && data.limitations.length) {
      const limit = create('div', 'local-result-limitations');
      limit.append(create('strong', '', 'Returned limitations'));
      const list = create('ul', 'local-limit-list');
      data.limitations.forEach((item) => list.append(create('li', '', textOf(item?.text || item, JSON.stringify(item)))));
      limit.append(list);
      output.append(limit);
    }
    $('download-candidate-button').hidden = typeof data.candidate_source !== 'string';
    $('download-report-button').hidden = false;
    $('local-verify-output').hidden = false;
    const passed = Number(data.after?.summary?.passed);
    const total = Number(data.after?.summary?.total);
    setLocalStatus(Number.isFinite(passed) && Number.isFinite(total) && total > 0 && passed === total
      ? 'All returned checks passed for this candidate in this one browser journey. Review the limitations above. No model request was made during verification.'
      : `${renderSummary(data.after?.summary)} for the candidate. Review the before/after traces and limitations above. No model request was made during verification.`, false);
  }

  async function verifyLocalCandidate() {
    if (!state.local.proposal?.candidate_source || !state.local.assetsValid || !$('run-consent').checked || !state.local.journey.length) return;
    setBusy('verify-local-button', true, 'Verifying…');
    clearLocalVerification();
    setLocalStatus('Sending the original and candidate HTML plus selected assets to this local server for fresh Chromium runs. No model request is made.');
    try {
      const source = await readSelectedSource();
      const assets = await readSelectedAssets();
      const data = await requestJson('/api/local-verify', {
        method: 'POST',
        body: JSON.stringify({
          source,
          candidate_source: state.local.proposal.candidate_source,
          journey: currentJourney(),
          assets,
          consent: true
        })
      });
      state.local.verification = data;
      renderLocalComparison(data);
      $('local-verify-output').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (error) {
      $('local-verify-output').replaceChildren(create('div', 'local-action-error', error.message));
      $('local-verify-output').hidden = false;
      setLocalStatus(error.message, true);
    } finally {
      $('run-consent').checked = false;
      setBusy('verify-local-button', false);
    }
  }

  function downloadCandidate() {
    const source = state.local.verification?.candidate_source || state.local.proposal?.candidate_source;
    if (typeof source !== 'string') return;
    const blob = new Blob([source], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const name = (state.local.file?.name || 'page.html').replace(/[^\w.-]+/g, '_').replace(/\.html?$/i, '');
    anchor.href = url;
    anchor.download = `${name || 'page'}.accesspatch-candidate.html`;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLocalStatus('Candidate HTML downloaded. AccessPatch did not replace the source file.');
  }

  function downloadEvidenceReport() {
    const result = state.local.verification;
    if (!result) return;
    const serverLimitations = Array.isArray(result.limitations) ? result.limitations : [];
    const report = {
      title: 'AccessPatch local keyboard verification',
      generated_at: new Date().toISOString(),
      scope: 'One user-selected HTML file, explicitly selected relative CSS/JS assets, and one keyboard journey. This is not a site-wide accessibility audit or compliance claim.',
      source_transmission: {
        model_proposal: state.local.proposal
          ? 'A separate, explicitly consented local-propose request sent the HTML source to NVIDIA Nemotron via Nebius Token Factory. Selected CSS/JS asset contents were not sent.'
          : 'No model proposal was made in this UI session.',
        verification: 'This local-verify request sent the original HTML, candidate HTML, keyboard journey, and selected CSS/JS contents to the local AccessPatch server. Verification did not send source or assets to Nebius or another model.'
      },
      keyboard_journey: currentJourney(),
      selected_asset_paths: state.local.assets.map((asset) => asset.path),
      asset_contents_included: false,
      browser_run: {
        engine: 'Fresh local Chromium context',
        javascript: 'Enabled for the trusted user-selected source and candidate',
        network: 'HTTP and WebSocket requests intercepted; other browser network paths are not guaranteed blocked',
        resource_log: 'Before and after resource lists record intercepted HTTP requests only, with a cap of 200 records per run. They are not a complete network or asset fidelity report; other browser resource mechanisms may not appear.',
        service_workers_and_downloads: 'Blocked',
        isolation: 'Browser context only; not OS-level containment',
        focus_trace: 'Focused element is browser-observed. Displayed role and name are DOM-based approximations, not platform accessibility-tree values.'
      },
      model: state.local.proposal?.model || null,
      proposal: state.local.proposal?.proposal || null,
      before: result.before || null,
      after: result.after || null,
      proposed_diff: result.diff || '',
      limitations: [
        ...serverLimitations,
        'Only explicitly selected relative CSS/JS files are served from memory. Other HTTP resources are blocked; other browser network paths are not guaranteed blocked.',
        'The resource log covers intercepted HTTP requests only. Other resource mechanisms may not appear in it; visually hidden controls may appear in focus traces and results can differ from the deployed page.',
        'This browser evidence covers only the selected keyboard journey and does not establish WCAG compliance or full accessibility.'
      ]
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const name = (state.local.file?.name || 'page.html').replace(/[^\w.-]+/g, '_').replace(/\.html?$/i, '');
    anchor.href = url;
    anchor.download = `${name || 'page'}.accesspatch-evidence.json`;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLocalStatus('Evidence report downloaded with the returned limitations and browser-run caveats.');
  }

  function bind() {
    $('propose-button').addEventListener('click', proposeFixture);
    $('verify-button').addEventListener('click', verifyFixture);
    $('select-all-button').addEventListener('click', () => {
      $('repair-options').querySelectorAll('input[data-repair-id]').forEach((input) => { input.checked = true; state.selectedRepairs.add(input.dataset.repairId); });
      updateSelectionState();
    });
    $('clear-selection-button').addEventListener('click', () => {
      state.selectedRepairs.clear();
      $('repair-options').querySelectorAll('input[data-repair-id]').forEach((input) => { input.checked = false; });
      updateSelectionState();
    });
    $('copy-diff-button').addEventListener('click', async () => {
      const diff = state.fixtureVerification?.diff;
      if (typeof diff !== 'string') return;
      try {
        await navigator.clipboard.writeText(diff);
        const button = $('copy-diff-button');
        button.replaceChildren(create('span', '', '✓'), document.createTextNode(' Copied'));
        setTimeout(() => {
          button.replaceChildren(create('span', '', '▢'), document.createTextNode(' Copy diff'));
        }, 1300);
      } catch {
        setFixtureError('Clipboard access is unavailable. Select and copy the diff text directly.');
      }
    });
    $('html-file').addEventListener('change', handleFileChange);
    $('asset-folder').addEventListener('change', handleAssetFolderChange);
    $('clear-assets-button').addEventListener('click', clearSelectedAssets);
    $('add-key-button').addEventListener('click', () => {
      if (state.local.journey.length >= MAX_KEYS) return;
      state.local.journey.push('Tab');
      journeyChanged();
      const selects = $('journey-steps').querySelectorAll('select');
      selects[selects.length - 1]?.focus();
      setLocalStatus('Key added. Choose the exact key for each step in order.');
    });
    $('run-consent').addEventListener('change', syncButtons);
    $('model-consent').addEventListener('change', syncButtons);
    $('inspect-local-button').addEventListener('click', captureLocalBaseline);
    $('propose-local-button').addEventListener('click', proposeLocalRepair);
    $('verify-local-button').addEventListener('click', verifyLocalCandidate);
    $('download-candidate-button').addEventListener('click', downloadCandidate);
    $('download-report-button').addEventListener('click', downloadEvidenceReport);
  }

  bind();
  renderJourney();
  loadWorkspace();
})();
