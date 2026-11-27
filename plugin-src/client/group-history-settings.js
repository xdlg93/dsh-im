import * as React from 'react';
import { h } from './i18n.js';

export const GROUP_HISTORY_SETTINGS_ENDPOINTS = Object.freeze({
  get: 'settings.group-history.get', set: 'settings.group-history.set',
});

function result(value) {
  if (value?.ok === false) throw new Error(value.error?.message || '无法读取或保存群记录设置，请稍后重试。');
  return value?.ok === true ? value.value : value;
}

export function GroupHistorySettings({ rpcCall }) {
  const [days, setDays] = React.useState('7');
  const [enabled, setEnabled] = React.useState(false);
  const [attachments, setAttachments] = React.useState(false);
  const [phase, setPhase] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const mounted = React.useRef(false);
  const busy = React.useRef(false);
  const id = React.useId();
  const load = React.useCallback(async (signal) => {
    setPhase('loading'); setError(null);
    try {
      const settings = result(await rpcCall(GROUP_HISTORY_SETTINGS_ENDPOINTS.get, {}, signal));
      if (signal?.aborted || !mounted.current) return;
      if (!Number.isSafeInteger(settings?.groupHistoryRetentionDays)) throw new Error('群记录设置返回了无法识别的响应。');
      setDays(String(settings.groupHistoryRetentionDays));
      setEnabled(settings.groupHistoryEnabled === true);
      setAttachments(settings.groupHistoryAttachments === true);
      setError(settings.error ?? null); setPhase('ready');
    } catch (caught) {
      if (signal?.aborted || !mounted.current) return;
      setError(caught.message); setPhase('error');
    }
  }, [rpcCall]);
  React.useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [load]);

  const save = async (event) => {
    event.preventDefault();
    if (busy.current || phase !== 'ready') return;
    const value = Number(days);
    if (!/^\d+$/.test(days.trim()) || !Number.isSafeInteger(value) || value < 1 || !Number.isSafeInteger(value * 86400000)) {
      setError('保留天数必须为正整数。'); return;
    }
    busy.current = true; setPhase('saving'); setError(null); setNotice(null);
    try {
      const settings = result(await rpcCall(GROUP_HISTORY_SETTINGS_ENDPOINTS.set, {
        groupHistoryRetentionDays: value,
        groupHistoryEnabled: enabled,
        groupHistoryAttachments: enabled && attachments,
      }));
      if (mounted.current) {
        setDays(String(settings.groupHistoryRetentionDays));
        setEnabled(settings.groupHistoryEnabled === true);
        setAttachments(settings.groupHistoryAttachments === true);
        setNotice('已保存');
      }
    } catch (caught) { if (mounted.current) setError(caught.message); }
    finally { busy.current = false; if (mounted.current) setPhase('ready'); }
  };
  return h('section', { className: 'dim-botGeneralSettings dim-groupHistorySettings', 'aria-label': '群聊天记录', 'aria-busy': phase === 'loading' || phase === 'saving' },
    h('form', { onSubmit: save },
      h('div', { className: 'dim-botGeneralRow' },
        h('div', { className: 'dim-botGeneralText' },
          h('label', { className: 'dim-botGeneralTitle', htmlFor: `${id}-enabled` }, '记录群聊天'),
          h('p', { className: 'dim-botGeneralHelp', id: `${id}-enabled-help` },
            '默认关闭。打开后，机器人在的群里即使没有 @ 它，消息也会存到本机，供之后检索；不需要就别开。')),
        h('div', { className: 'dim-botGeneralControl dim-groupHistoryControl' },
          h('input', { id: `${id}-enabled`, type: 'checkbox', checked: enabled, disabled: phase !== 'ready',
            'aria-describedby': `${id}-enabled-help`,
            onChange: (event) => { setEnabled(event.target.checked); setNotice(null); } }))),
      h('div', { className: 'dim-botGeneralRow' },
        h('div', { className: 'dim-botGeneralText' },
          h('label', { className: 'dim-botGeneralTitle', htmlFor: `${id}-attachments` }, '同时保存群文件'),
          h('p', { className: 'dim-botGeneralHelp', id: `${id}-attachments-help` },
            '关闭时只记录文字与附件信息，不下载文件本体。需要下载才打开。')),
        h('div', { className: 'dim-botGeneralControl dim-groupHistoryControl' },
          h('input', { id: `${id}-attachments`, type: 'checkbox', checked: attachments,
            disabled: phase !== 'ready' || !enabled, 'aria-describedby': `${id}-attachments-help`,
            onChange: (event) => { setAttachments(event.target.checked); setNotice(null); } }))),
      h('div', { className: 'dim-botGeneralRow' },
        h('div', { className: 'dim-botGeneralText' },
          h('label', { className: 'dim-botGeneralTitle', htmlFor: `${id}-days` }, '群聊天记录保留天数'),
          h('p', { className: 'dim-botGeneralHelp', id: `${id}-description` }, '过期的群消息和文件会自动清理。')),
        h('div', { className: 'dim-botGeneralControl dim-groupHistoryControl' },
          h('input', { id: `${id}-days`, className: 'dim-groupHistoryInput', type: 'number', min: 1, step: 1,
            value: days, disabled: phase !== 'ready', 'aria-describedby': `${id}-description`,
            onChange: (event) => { setDays(event.target.value); setNotice(null); } }),
          h('span', { className: 'dim-groupHistoryUnit' }, '天'))),
      h('div', { className: 'dim-botGeneralActions' },
        h('button', { type: 'submit', className: 'dim-deliveryButton dim-groupHistorySave', 'data-kind': 'primary',
          disabled: phase !== 'ready' }, phase === 'saving' ? '保存中…' : '保存'))),
    phase === 'loading' ? h('p', { role: 'status', className: 'dim-botGeneralHelp dim-groupHistoryFeedback' }, '正在读取群记录设置…') : null,
    error ? h('p', { role: 'alert', className: 'dim-accessFeedback dim-groupHistoryFeedback', 'data-tone': 'error' }, error) : null,
    notice ? h('p', { role: 'status', className: 'dim-botGeneralHelp dim-groupHistoryFeedback' }, notice) : null);
}
