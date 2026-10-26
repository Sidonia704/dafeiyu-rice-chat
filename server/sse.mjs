// SSE 的网络分包不等于 token，也不一定等于完整一行。
export async function* readSSE(stream) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of stream) {
    buffer += decoder.decode(bytes, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
  buffer += decoder.decode();
  const data = buffer.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (data) yield data;
}
