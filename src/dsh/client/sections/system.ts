/** System section: capabilities, connected devices, and diagnostics. */

import type * as React from 'react';
import { Btn, StatusRow, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi, ProbeBackends } from '../types.js';
import { formatBytes, formatDuration } from '../logic.js';

function factRow(key: string, label: string, value: React.ReactNode, wide = false): React.ReactElement {
  return h('div', { className: `drc-fact-row${wide ? ' is-wide' : ''}`, key },
    h('span', { className: 'drc-fact-key' }, label),
    h('span', { className: 'drc-fact-value' }, value),
  );
}

function statusGroup(api: PanelApi): React.ReactElement {
  const { t, data } = api;
  const capabilities = data.capabilities ?? {};
  const probe = capabilities.probe;
  const node = capabilities.node;
  const backends = probe?.backends;
  const labels = { okLabel: t('healthy'), badLabel: t('unavailable'), pendingLabel: t('checking') };
  const probeReady = probe ? probe.ok ?? probe.available : undefined;
  const capabilityValue = (key: keyof ProbeBackends): boolean | undefined => {
    if (!probe) return undefined;
    if (!backends) return probeReady === false ? false : undefined;
    return Boolean(backends[key]) && probeReady === true;
  };
  return h('div', { className: 'drc-group' },
    groupHead(t('status'), t('statusHint')),
    h(StatusRow, {
      label: t('notificationsStatus'),
      value: capabilities.notifications?.available,
      detail: backends?.notifications,
      ...labels,
    }),
    h(StatusRow, {
      label: t('mediaStatus'),
      value: capabilities.media?.available ?? capabilities.media?.ok,
      detail: backends?.media,
      ...labels,
    }),
    h(StatusRow, {
      label: t('volumeStatus'),
      value: capabilities.volume?.available ?? capabilities.volume?.ok,
      detail: backends?.volume,
      ...labels,
    }),
    h(StatusRow, {
      label: t('performanceStatus'),
      value: capabilityValue('performance'),
      detail: backends?.performance,
      ...labels,
    }),
    h(StatusRow, {
      label: t('locationCapability'),
      value: capabilityValue('location'),
      detail: backends?.location,
      ...labels,
    }),
    h(StatusRow, {
      label: t('weatherStatus'),
      value: capabilities.weather?.ok ?? undefined,
      detail: node ? 'Node.js' : undefined,
      ...labels,
    }),
  );
}

function diagnosticsGroup(api: PanelApi): React.ReactElement {
  const { t, data, info } = api;
  const diagnostics = data.diagnostics ?? {};
  const probe = data.capabilities?.probe;
  const node = data.capabilities?.node;
  const left = [
    factRow('protocol', t('protocol'), diagnostics.protocol || info.protocol || 'http'),
    factRow('profile', t('profileName'), diagnostics.profile || '—'),
    factRow('plugin-version', t('pluginVersion'), diagnostics.version || info.version || '—'),
    factRow('probe-version', t('probeVersion'), probe?.version || (probe?.available ? '—' : t('probeMissing'))),
  ];
  const right = [
    factRow('node-version', t('nodeVersion'), node?.version || '—'),
    factRow('node-v8', t('nodeV8'), node?.v8 || '—'),
    factRow('node-platform', t('nodePlatform'), node ? `${node.platform}/${node.arch}` : '—'),
    factRow('node-memory', t('nodeMemory'), node?.memory ? `${formatBytes(node.memory.rss)} / ${formatBytes(node.memory.heapUsed)}` : '—'),
  ];
  return h('div', { className: 'drc-group' },
    groupHead(t('diagnostics'), t('diagnosticsHint')),
    h('div', { className: 'drc-fact-columns' },
      h('div', { className: 'drc-fact-column' }, left),
      h('div', { className: 'drc-fact-column' }, right),
    ),
    factRow('probe-binary', t('probeBinary'), probe?.binary || '—', true),
    probe?.error ? factRow('probe-error', t('error'), probe.error, true) : null,
  );
}

function clientsGroup(api: PanelApi): React.ReactElement {
  const { t, clients, disconnect } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('clients'), t('clientsHint')),
    clients.length === 0
      ? h('p', { className: 'drc-empty' }, t('noClients'))
      : h('div', { className: 'drc-list' }, clients.map((client) => h('div', { className: 'drc-client', key: client.id },
        h('div', { className: 'drc-client-main' },
          h('strong', null, client.label || t('device')),
          h('small', null, `${client.ip} · ${formatDuration(Date.now() - client.connectedAt, t)}`),
        ),
        h(Btn, { small: true, danger: true, onClick: () => void disconnect(client.id) }, t('disconnect')),
      ))),
  );
}

export function renderSystem(api: PanelApi): React.ReactElement {
  return h('div', { className: 'drc-section' },
    sectionHead(api.t('menuSystem'), api.t('systemPageHint')),
    statusGroup(api),
    clientsGroup(api),
    diagnosticsGroup(api),
  );
}
