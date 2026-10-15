const element = id => document.getElementById(id);
let source = null;
let activeResponse = null;
function stop(message) {
  source?.close(); source = null;
  activeResponse = null;
  element('caption').textContent = '—';
  element('start').disabled = false;
  element('stop').disabled = true;
  element('status').textContent = message;
}
element('stop').onclick = () => stop('已停止合成回放');
element('start').onclick = () => {
  stop('正在回放合成事件（豆包未连接）');
  element('events').replaceChildren();
  element('summary').textContent = '运行中';
  element('start').disabled = true;
  element('stop').disabled = false;
  source = new EventSource(`/api/replays/${element('scenario').value}`);
  source.addEventListener('accepted', message => {
    const event = JSON.parse(message.data);
    const row = document.createElement('li');
    row.textContent = `${event.seq}: ${event.type} ${event.response_id ?? ''}`;
    element('events').append(row);
    if (event.type === 'response.started') { activeResponse = event.response_id; element('caption').textContent = ''; }
    if (event.type === 'response.text.delta' && event.response_id === activeResponse) element('caption').textContent += event.payload.text;
    if (event.type === 'response.cancel.requested' && event.response_id === activeResponse) { activeResponse = null; element('caption').textContent = '—'; }
    if (event.type === 'session.failed' || event.type === 'session.closed') { activeResponse = null; element('caption').textContent = '—'; }
  });
  source.addEventListener('dropped', message => {
    const event = JSON.parse(message.data);
    const row = document.createElement('li'); row.className = 'dropped';
    row.textContent = `已丢弃 ${event.event_id}: ${event.reason}`;
    element('events').append(row);
  });
  source.addEventListener('summary', message => {
    element('summary').textContent = JSON.stringify(JSON.parse(message.data), null, 2);
    stop('合成回放完成（豆包未连接）');
  });
  source.onerror = () => stop('回放连接已中断，可重新开始');
};
