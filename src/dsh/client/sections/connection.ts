/** Connection section: pairing, reachable interfaces, access token, and TLS. */

import type * as React from 'react';
import { Btn, Field, Row, Toggle, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi } from '../types.js';

function networkGroup(api: PanelApi): React.ReactElement {
  const { t, data, toggleInterface } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('network'), t('networkHint')),
    data.interfaces && data.interfaces.length > 0
      ? h('div', { className: 'drc-list' }, data.interfaces.map((entry) => h('div', { className: 'drc-list-row', key: `${entry.name}-${entry.address}` },
        h('label', null,
          h('input', {
            type: 'checkbox',
            checked: api.selectedInterfaces.includes(entry.name),
            onChange: () => toggleInterface(entry.name),
          }),
          h('span', null, entry.name),
        ),
        h('span', { className: 'drc-code' }, entry.cidr || entry.address),
      )))
      : h('p', { className: 'drc-empty' }, '—'),
  );
}

function accessGroup(api: PanelApi): React.ReactElement {
  const { t, settings, stage, busy, rotate } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('access'), t('accessHint')),
    h(Row, { title: t('token') },
      h(Toggle, { checked: settings.tokenEnabled, label: t('token'), onChange: (checked) => stage({ tokenEnabled: checked }) }),
    ),
    h('div', { className: 'drc-divider' }),
    h('div', { className: 'drc-actions drc-actions-stack' },
      h(Btn, { danger: true, disabled: busy, onClick: () => void rotate() }, t('rotate')),
      h('span', { className: 'drc-row-desc' }, t('rotateHint')),
    ),
  );
}

function tlsGroup(api: PanelApi): React.ReactElement {
  const { t, settings, draft, info, stage, setDraft, setError } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('tls'), t('tlsHint')),
    h(Row, { title: t('tlsEnable') }, h(Toggle, {
      checked: settings.tls?.enabled,
      label: t('tlsEnable'),
      onChange: (checked) => {
        if (checked && (!draft.certPath || !draft.keyPath)) {
          setError(t('tlsPathsRequired'));
          return;
        }
        stage({ tls: { enabled: checked } });
      },
    })),
    h('div', { className: 'drc-divider' }),
    h('div', { className: 'drc-fields' },
      h(Field, { label: t('certPath'), value: draft.certPath, placeholder: 'C:\\certs\\fullchain.pem', onChange: (value) => setDraft((current) => ({ ...current, certPath: value })) }),
      h(Field, { label: t('keyPath'), value: draft.keyPath, placeholder: 'C:\\certs\\privkey.pem', onChange: (value) => setDraft((current) => ({ ...current, keyPath: value })) }),
    ),
    h('div', { className: 'drc-actions' },
      h('span', { className: 'drc-row-desc' }, settings.tls?.enabled ? (info.tls?.active ? t('tlsOn') : t('tlsError')) : t('tlsOff')),
    ),
  );
}

function pairingGroup(api: PanelApi): React.ReactElement {
  const { t, info, copied, copy } = api;
  const remote = info.routes?.remote || '';
  return h('div', { className: 'drc-group' },
    groupHead(t('pairing'), t('pairingHint')),
    h('div', { className: 'drc-qr' },
      info.qrPath
        ? h('div', { className: 'drc-qr-frame' }, h('img', { src: info.qrPath, alt: t('pairing'), width: 160, height: 160 }))
        : h('div', { className: 'drc-qr-frame' }),
      h('div', { className: 'drc-qr-copy' },
        h('div', { className: 'drc-actions', style: { marginTop: 0, paddingTop: 0 } },
          h(Btn, { primary: true, disabled: !remote, onClick: () => window.open(remote, '_blank', 'noopener,noreferrer') }, t('open')),
          h(Btn, { disabled: !remote, onClick: () => void copy() }, copied ? t('copied') : t('copy')),
        ),
        h('code', { className: 'drc-url' }, remote || '—'),
        info.tls?.error ? h('p', { className: 'drc-row-desc', style: { color: 'var(--drc-error)', marginTop: 8 } }, `${t('tlsError')}: ${info.tls.error}`) : null,
      ),
    ),
  );
}

export function renderConnection(api: PanelApi): React.ReactElement {
  return h('div', { className: 'drc-section' },
    sectionHead(api.t('connection'), api.t('connectionHint')),
    pairingGroup(api),
    networkGroup(api),
    accessGroup(api),
    tlsGroup(api),
  );
}
