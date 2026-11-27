export const GROUP_HISTORY_ENDPOINTS = Object.freeze({
  get: 'settings.group-history.get', set: 'settings.group-history.set',
});

export function createGroupHistoryRpcHandler(store) {
  return async (endpoint, payload, signal) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || signal?.aborted) {
      return { ok: false, error: { code: 'bad-request', message: '群记录设置请求无效。' } };
    }
    const keys = Object.keys(payload).sort().join(',');
    try {
      let value;
      if (endpoint === GROUP_HISTORY_ENDPOINTS.get && keys === '') value = await store.settings();
      else if (endpoint === GROUP_HISTORY_ENDPOINTS.set && keys === 'groupHistoryRetentionDays') value = await store.setRetentionDays(payload.groupHistoryRetentionDays);
      // The archive is opt-in, and copying attachments is a second opt-in: both
      // switches travel together so one save cannot leave a half-enabled archive.
      else if (endpoint === GROUP_HISTORY_ENDPOINTS.set
        && keys === 'groupHistoryAttachments,groupHistoryEnabled,groupHistoryRetentionDays') {
        // The panel saves the retention and both switches together.
        await store.setRetentionDays(payload.groupHistoryRetentionDays);
        value = await store.setEnabled({
          enabled: payload.groupHistoryEnabled,
          attachments: payload.groupHistoryAttachments,
        });
      } else if (endpoint === GROUP_HISTORY_ENDPOINTS.set && keys === 'groupHistoryAttachments,groupHistoryEnabled') {
        value = await store.setEnabled({
          enabled: payload.groupHistoryEnabled,
          attachments: payload.groupHistoryAttachments,
        });
      } else throw new Error('群记录设置请求无效。');
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: { code: error.code ?? 'group-history-unavailable',
        message: error.code === 'group-history-invalid' ? error.message : '无法读取或保存群记录设置，请稍后重试。' } };
    }
  };
}
