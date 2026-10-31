// Uses Harness's supported browser module and layout slot; never patches vendor DOM.
window.__ModuleLoader__.load({
  id: 'blinkflow-canvas-ui',
  factory: (require) => {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const css = `
.bfcui-bar{box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:9px 16px;border-top:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:13px/20px var(--dsw-font-family);min-width:0}
.bfcui-label{flex-shrink:0;color:var(--dsw-alias-label-secondary)}
.bfcui-trigger{flex:1;min-width:0;text-align:left}
.bfcui-button{font:inherit;color:inherit;border:0;border-radius:8px;background:transparent;cursor:pointer;padding:7px 10px;white-space:normal;overflow-wrap:anywhere}
.bfcui-button:hover:not(:disabled),.bfcui-button:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.bfcui-button:focus-visible{outline:2px solid var(--dsw-alias-border-l4);outline-offset:-2px}
.bfcui-button:disabled{opacity:.55;cursor:default}
.bfcui-menu{position:fixed;z-index:2000;box-sizing:border-box;display:flex;flex-direction:column;max-height:calc(100vh - 80px);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;box-shadow:var(--dsw-elevation-panel);font:13px/20px var(--dsw-font-family);overflow:hidden}
.bfcui-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;border-bottom:.5px solid var(--dsw-alias-border-l3);overflow-wrap:anywhere}
.bfcui-list{overflow-y:auto;min-height:0;padding:6px;overscroll-behavior:contain}
.bfcui-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left}
.bfcui-row>span:first-child{min-width:0}
.bfcui-row[aria-checked=true]{background:var(--dsw-alias-interactive-bg-active);font-weight:600}
.bfcui-secondary{color:var(--dsw-alias-label-secondary);flex-shrink:0;font-size:12px}
.bfcui-info{padding:8px 10px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.bfcui-error{color:var(--dsw-alias-state-error-primary)}
`;
    function ImageModelPicker() {
      const api = window.blinkflowHarnessModels;
      const [state, setState] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [channelId, setChannelId] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [position, setPosition] = React.useState(null);
      const trigger = React.useRef(null);
      const menu = React.useRef(null);
      const alive = React.useRef(false);
      const current = React.useRef(state);
      current.current = state;
      React.useEffect(() => {
        alive.current = true;
        if (!api) { setError('请从 BlinkFlow 画布打开 Harness'); return () => { alive.current = false; }; }
        let active = true;
        let revision = 0;
        const off = api.onChange((next) => { revision++; if (active) setState(next); });
        const initial = revision;
        api.get().then((next) => { if (active && revision === initial) setState(next); }).catch((reason) => { if (active && revision === initial) setError(String(reason?.message || reason)); });
        return () => { active = false; alive.current = false; off(); };
      }, [api]);
      React.useEffect(() => { setOpen(false); setChannelId(null); if (api) setError(''); }, [state?.projectId]);
      React.useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
          const rect = trigger.current?.getBoundingClientRect();
          if (!rect) return;
          const width = Math.min(540, window.innerWidth - 24);
          setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(0, rect.top - 20) });
        };
        const outside = (event) => { if (!trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
        const escape = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
        place();
        window.addEventListener('resize', place);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape, true);
        return () => { window.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
      }, [open]);
      React.useEffect(() => {
        if (open && position) (menu.current?.querySelector('[aria-checked="true"]:not(:disabled)') || menu.current?.querySelector('button:not(:disabled)'))?.focus();
      }, [open, channelId, Boolean(position)]);
      const channels = state?.channels || [];
      const selected = state?.selectedImageModel || '';
      const selectedChannel = channels.find((channel) => channel.models.some((model) => model.id === selected));
      const selectedModel = selectedChannel?.models.find((model) => model.id === selected);
      const channel = channels.find((item) => item.id === channelId);
      const invalid = Boolean(selected && !selectedModel);
      const label = !state ? '请先打开画布' : invalid ? '所选生图模型已失效，请重新选择' : selectedModel ? selectedChannel.name + ' → ' + selectedModel.name : '沿用节点 / 画布默认模型';
      const choose = async (imageModel) => {
        const projectId = state?.projectId;
        if (!api || !projectId || busy) return;
        setBusy(true); setError('');
        try {
          await api.select(imageModel);
          if (alive.current && current.current?.projectId === projectId) { setOpen(false); trigger.current?.focus(); }
        } catch (reason) { if (alive.current && current.current?.projectId === projectId) setError(String(reason?.message || reason)); }
        finally { if (alive.current) setBusy(false); }
      };
      const row = (id, title, checked, onClick, suffix) => h('button', { key: id, type: 'button', role: 'menuitemradio', 'aria-checked': checked, className: 'bfcui-button bfcui-row', title, disabled: busy, onClick }, h('span', null, title), h('span', { className: 'bfcui-secondary', 'aria-hidden': true }, checked ? '✓' : suffix || ''));
      const menuKeys = (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...menu.current.querySelectorAll('button:not(:disabled)')];
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      };
      return h(React.Fragment, null,
        h('style', null, css),
        h('div', { className: 'bfcui-bar', 'data-blinkflow-image-models': true },
          h('span', { className: 'bfcui-label' }, '画布生图模型'),
          h('button', { ref: trigger, type: 'button', className: 'bfcui-button bfcui-trigger' + (invalid ? ' bfcui-error' : ''), disabled: !state || busy, title: label, 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => { setChannelId(null); setOpen(!open); } }, busy ? '正在保存…' : label + ' ▾'),
          error && !open ? h('span', { className: 'bfcui-error', role: 'alert' }, error) : null),
        open && position ? createPortal(h('div', { ref: menu, className: 'bfcui-menu', style: position, role: 'menu', 'aria-label': '选择画布生图模型', onKeyDown: menuKeys },
          h('div', { className: 'bfcui-header' },
            h('button', { type: 'button', className: 'bfcui-button', disabled: busy, onClick: () => { if (channelId !== null) setChannelId(null); else setOpen(false); } }, channelId === null ? '选择生图中转站' : '← 中转站 / ' + (channel?.name || '已移除')),
            h('button', { type: 'button', className: 'bfcui-button', 'aria-label': '关闭模型选择', onClick: () => { setOpen(false); trigger.current?.focus(); } }, '×')),
          h('div', { className: 'bfcui-list' }, channelId === null ? [
            row('default', '沿用节点 / 画布默认模型', !selected, () => choose('')),
            ...channels.map((item) => row(item.id, item.name, item.id === selectedChannel?.id, () => setChannelId(item.id), item.models.length + ' 个模型 ›')),
            !channels.length ? h('div', { key: 'empty', className: 'bfcui-info' }, '暂无中转站。请在画布渠道中添加并拉取图片模型，这里会自动同步。') : null,
          ] : channel?.models.length ? channel.models.map((model) => row(model.id, model.name, model.id === selected, () => choose(model.id))) : h('div', { className: 'bfcui-info' }, '该中转站暂无图片模型，请在画布渠道中拉取并标记图片能力。')),
          h('div', { className: 'bfcui-info' }, '仅选择画布生图模型，不改变 DeepSeek 对话模型。'),
          error ? h('div', { className: 'bfcui-info bfcui-error', role: 'alert' }, error) : null), document.body) : null);
    }
    return {
      inject: ['slots'],
      apply(ctx) { ctx.slots.inject('shell.bottom', () => ctx.slots.register({ name: 'shell.bottom' }, ImageModelPicker)); },
    };
  },
});
